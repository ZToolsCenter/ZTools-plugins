{
  "targets": [
    {
      "target_name": "wechat_ocr",
      "conditions": [
        [
          "OS=='win'",
          {
            "sources": [
              "src/addon.cc",
              "src/mmmojo.cc",
              "src/ocr_manager.cc",
              "src/pb.cc"
            ]
          }
        ],
        [
          "OS=='mac'",
          {
            "sources": [
              "src/addon_mac.cpp",
              "src/wxocr_wevision_probe.cpp"
            ],
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.15"
            }
          }
        ]
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NAPI_VERSION=8"
      ],
      "cflags_cc": ["-std=c++17"],
      "cflags_cc!": ["-fno-exceptions"],
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
