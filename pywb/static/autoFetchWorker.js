'use strict';
// thanks wombat
var STYLE_REGEX = /(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\))/gi;
var IMPORT_REGEX = /(@import\s+[\\"']*)([^)'";]+)([\\"']*\s*;?)/gi;
var srcsetSplit = /\s*(\S*\s+[\d.]+[wx]),|(?:\s*,(?:\s+|(?=https?:)))/;
// the autofetcher instance for this worker
var autofetcher = null;

function noop() {}

if (typeof self.Promise === 'undefined') {
    // not kewl we must polyfill Promise
    self.Promise = function (executor) {
        executor(noop, noop);
    };
    self.Promise.prototype.then = function (cb) {
        if (cb) cb();
        return this;
    };
    self.Promise.prototype.catch = function () {
        return this;
    };
    self.Promise.all = function (values) {
        return new Promise(noop);
    };
}

if (typeof self.fetch === 'undefined') {
    // not kewl we must polyfill fetch.
    self.fetch = function (url) {
        return new Promise(function (resolve) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url);
            xhr.send();
            resolve();
        });
    };
}

self.onmessage = function (event) {
    var data = event.data;
    switch (data.type) {
        case 'values':
            autofetcher.autofetchMediaSrcset(data);
            break;
    }
};

function AutoFetcher(init) {
    if (!(this instanceof AutoFetcher)) {
        return new AutoFetcher(init);
    }
    this.prefix = init.prefix;
    this.mod = init.mod;
    this.prefixMod = init.prefix + init.mod;
    // relative url, WorkerLocation is set by owning document
    this.relative = init.prefix.split(location.origin)[1];
    // schemeless url
    this.schemeless = '/' + this.relative;
    // local cache of URLs fetched, to reduce server load
    this.seen = {};
    // array of URL to be fetched
    this.queue = [];
    // should we queue a URL or not
    this.queuing = false;
    this.urlExtractor = this.urlExtractor.bind(this);
    this.fetchDone = this.fetchDone.bind(this);
}

AutoFetcher.prototype.fixupURL = function (url) {
    // attempt to fix up the url and do our best to ensure we can get dat 200 OK!
    if (url.indexOf(this.prefixMod) === 0) {
        return url;
    }
    if (url.indexOf(this.relative) === 0) {
        return url.replace(this.relative, this.prefix);
    }
    if (url.indexOf(this.schemeless) === 0) {
        return url.replace(this.schemeless, this.prefix);
    }
    if (url.indexOf(this.prefix) !== 0) {
        return this.prefix + url;
    }
    return url;
};

AutoFetcher.prototype.queueURL = function (url) {
    // ensure we do not request data urls
    if (url.indexOf('data:') === 0) return;
    // check to see if we have seen this url before in order
    // to lessen the load against the server content is fetched from
    if (this.seen[url] != null) return;
    this.seen[url] = true;
    this.queue.push(url);
};

AutoFetcher.prototype.urlExtractor = function (match, n1, n2, n3, offset, string) {
    // Same function as style_replacer in wombat.rewrite_style, n2 is our URL
    this.queueURL(this.fixupURL(n2));
    return n1 + n2 + n3;
};

AutoFetcher.prototype.delay = function () {
    // 2 second delay seem reasonable
    return new Promise(function (resolve, reject) {
        setTimeout(resolve, 2000);
    });
};

AutoFetcher.prototype.fetchDone = function () {
    this.queuing = false;
    if (this.queue.length > 0) {
        // we have a Q of some length drain it
        var autofetcher = this;
        this.delay().then(function () {
            autofetcher.fetchAll();
        });
    }
};

AutoFetcher.prototype.fetchAll = function () {
    if (this.queuing || this.queue.length === 0) {
        return;
    }
    // the number of fetches is limited to a maximum of 60 outstanding fetches
    // the baseline maximum number of fetches is 50 but if the size(queue) <= 10
    // we add them to the current batch
    this.queuing = true;
    var runningFetchers = [];
    while (this.queue.length > 0 && runningFetchers.length <= 50) {
        runningFetchers.push(fetch(this.queue.shift()).catch(noop))
    }
    if (this.queue.length <= 10) {
        while (this.queue.length > 0) {
            runningFetchers.push(fetch(this.queue.shift()).catch(noop))
        }
    }
    Promise.all(runningFetchers)
        .then(this.fetchDone)
        .catch(this.fetchDone);
};

AutoFetcher.prototype.extractMedia = function (mediaRules) {
    // this is a broken down rewrite_style
    if (mediaRules == null || mediaRules.values === null) return;
    var rules = mediaRules.values;
    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        rule.replace(STYLE_REGEX, this.urlExtractor)
            .replace(IMPORT_REGEX, this.urlExtractor);
    }
};

AutoFetcher.prototype.maybeFixUpRelSchemelessPrefix = function (url) {
    // attempt to ensure rewritten relative or schemeless URLs become full URLS!
    // otherwise returns null if this did not happen
    if (url.indexOf(this.relative) === 0) {
        return url.replace(this.relative, this.prefix);
    }
    if (url.indexOf(this.schemeless) === 0) {
        return url.replace(this.schemeless, this.prefix);
    }
    return null;
};

AutoFetcher.prototype.maybeResolveURL = function (url, base) {
    // given a url and base url returns a resolved full URL or
    // null if resolution was unsuccessful
    try {
        var _url = new URL(url, base);
        return _url.href;
    } catch (e) {
        return null;
    }
};


AutoFetcher.prototype.fixupURLSrcSet = function (url, tagSrc, context) {
    // attempt to fix up the url and do our best to ensure we can get dat 200 OK!
    if (url.indexOf(this.prefix) !== 0) {
        // first check for / (relative) or // (schemeless) rewritten urls
        var maybeFixed = this.maybeFixUpRelSchemelessPrefix(url);
        if (maybeFixed != null) {
            return maybeFixed;
        }
        // resolve URL against tag src
        if (tagSrc != null) {
            maybeFixed = this.maybeResolveURL(url, tagSrc);
            if (maybeFixed != null) {
                return this.prefix + 'im_/' + maybeFixed;
            }
        }
        // finally last attempt resolve the originating documents base URI
        maybeFixed = this.maybeResolveURL(url, context.docBaseURI);
        if (maybeFixed != null) {
            return this.prefix + 'im_/' + maybeFixed;
        }
        // not much to do now.....
        return this.prefixMod + '/' + url;
    }
    return url;
};

AutoFetcher.prototype.extractSrcset = function (srcsets, context) {
    if (srcsets == null || srcsets.values == null) return;
    var srcsetValues = srcsets.values;
    if (!srcsets.presplit) {
        // was from extract from local doc so we need to duplicate  work
        return this.srcsetNotPreSplit(srcsetValues, context);
    }
    // was rewrite_srcset so just ensure we just
    for (var i = 0; i < srcsetValues.length; i++) {
        // grab the URL not width/height key
        this.queueURL(srcsetValues[i].split(' ')[0]);
    }
};

AutoFetcher.prototype.srcsetNotPreSplit = function (values, context) {
    // was from extract from local doc so we need to duplicate  work
    var j;
    for (var i = 0; i < values.length; i++) {
        var srcsetValues = values[i].srcset.split(srcsetSplit);
        var tagSrc = values[i].tagSrc;
        for (j = 0; j < srcsetValues.length; j++) {
            // grab the URL not width/height key
            if (Boolean(srcsetValues[j])) {
                var value = srcsetValues[j].trim().split(' ')[0];
                this.queueURL(this.fixupURLSrcSet(value, tagSrc, context));
            }
        }
    }
};

AutoFetcher.prototype.autofetchMediaSrcset = function (data) {
    // we got a message and now we autofetch!
    // these calls turn into no ops if they have no work
    this.extractMedia(data.media);
    this.extractSrcset(data.srcset, data.context);
    this.fetchAll();
};

// initialize ourselves from the query params :)
try {
    var loc = new self.URL(location);
    autofetcher = new AutoFetcher(JSON.parse(loc.searchParams.get('init')));
} catch (e) {
    // likely we are in an older version of safari
    var search = decodeURIComponent(location.search.split('?')[1]).split('&');
    var init = JSON.parse(search[0].substr(search[0].indexOf('=') + 1));
    init.prefix = decodeURIComponent(init.prefix);
    init.baseURI = decodeURIComponent(init.baseURI);
    autofetcher = new AutoFetcher(init);
}
