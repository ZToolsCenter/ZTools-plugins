{
  "targets": [
    {
      "target_name": "wechat_ocr",
      "sources": [
        "src/addon.cc",
        "src/mmmojo.cc",
        "src/ocr_manager.cc",
        "src/pb.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags_cc": ["-std=c++17"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/utf-8"]
        }
      },
      "msvs_disabled_warnings": ["4267", "4244", "4100", "4819"]
    }
  ]
}
