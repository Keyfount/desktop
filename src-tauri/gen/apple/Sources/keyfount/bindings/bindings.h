#pragma once

namespace ffi {
    extern "C" {
        void start_app();
        char* derive_password_ffi(const char* master, const char* domain, const char* email, const char* profile_json);
        void free_password_ffi(char* s);
        int verify_master_ffi(const char* master, const char* expected_fp_hex);
        int record_account_ffi(const char* domain, const char* username, const char* profile_json);
    }
}

