#include "bindings/bindings.h"
#import <Foundation/Foundation.h>

int main(int argc, char * argv[]) {
    @autoreleasepool {
        NSURL *containerURL = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:@"group.io.keyfount.app"];
        if (containerURL != nil) {
            setenv("HOME", [[containerURL path] UTF8String], 1);
        }
    }
	ffi::start_app();
	return 0;
}
