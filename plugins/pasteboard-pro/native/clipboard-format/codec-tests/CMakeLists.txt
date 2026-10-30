cmake_minimum_required(VERSION 3.20)

project(clipboard-codec-tests LANGUAGES CXX)

add_executable(clipboard-codec-tests
  main.cpp
  capture_wire_cases.cpp
  capture_wire_v2_cases.cpp
  cf_html_cases.cpp
  png_cases.cpp
  policy_cases.cpp
  reparse_cases.cpp
  rtf_cases.cpp
  tiff_case_builder.cpp
  tiff_cases.cpp
  tiff_reference_cases.cpp
  url_cases.cpp
  ../common/clipboard_capture_policy.cpp
  ../common/clipboard_capture_wire.cpp
  ../common/clipboard_capture_codec.cpp
  ../common/clipboard_cf_html.cpp
  ../common/clipboard_sha256.cpp
  ../common/clipboard_codecs.cpp
  ../common/clipboard_palette.cpp
  ../common/clipboard_png.cpp
  ../common/clipboard_reparse.cpp
  ../common/clipboard_rtf.cpp
  ../common/clipboard_tiff.cpp
  ../common/clipboard_tiff_graph.cpp
  ../common/clipboard_tiff_image.cpp
  ../common/clipboard_tiff_reader.cpp
  ../common/clipboard_uri_syntax.cpp
  ../common/clipboard_url.cpp
)
target_include_directories(clipboard-codec-tests PRIVATE ../common)
target_compile_features(clipboard-codec-tests PRIVATE cxx_std_17)
enable_testing()
add_test(NAME clipboard-codecs COMMAND clipboard-codec-tests)
if(MSVC)
  target_compile_options(clipboard-codec-tests PRIVATE /W4 /utf-8 /permissive-)
else()
  target_compile_options(clipboard-codec-tests PRIVATE -Wall -Wextra -Wpedantic)
endif()
