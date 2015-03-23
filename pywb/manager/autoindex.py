import sys
import time
from watchdog.observers import Observer
from watchdog.events import RegexMatchingEventHandler


#=============================================================================
EXT_REGEX = '.*\.w?arc(\.gz)?$'

keep_running = True

#=============================================================================
class CDXAutoIndexer(RegexMatchingEventHandler):
    def __init__(self, updater, path):
        super(CDXAutoIndexer, self).__init__(regexes=[EXT_REGEX],
                                             ignore_directories=True)
        self.updater = updater
        self.cdx_path = path

    def on_created(self, event):
        self.updater(event.src_path)

    def on_modified(self, event):
        self.updater(event.src_path)

    def do_watch(self, sleep_time=1):
        observer = Observer()
        observer.schedule(self, self.cdx_path, recursive=True)
        observer.start()

        try:
            while keep_running:
                time.sleep(sleep_time)
        except KeyboardInterrupt:  # pragma: no cover
            observer.stop()
            observer.join()


#=============================================================================
if __name__ == "__main__":
    w = Watcher(sys.argv[1] if len(sys.argv) > 1 else '.')
    def p(x):
        print(x)
    w.run(p)
