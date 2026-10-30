cmake_minimum_required(VERSION 3.24)

project(clipboard-format-probe LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR
    "clipboard-format-probe uses Win32 APIs and must be built with a Windows SDK.")
endif()

if(NOT MSVC)
  message(FATAL_ERROR
    "Use MSVC with the Windows SDK so the probe matches the supported host toolchain.")
endif()

add_executable(clipboard-format-probe
  clipboard_api_capture_fault_tests.cpp
  clipboard_api_fault_test_support.cpp
  clipboard_api_publish_fault_tests.cpp
  clipboard_capture.cpp
  clipboard_capture_policy.cpp
  clipboard_capture_validation.cpp
  clipboard_payload_transport.cpp
  clipboard_delayed_read_fixture.cpp
  clipboard_file_reference_access.cpp
  clipboard_file_reference_fixture.cpp
  clipboard_file_reference_paths.cpp
  clipboard_file_references.cpp
  clipboard_file_references_tests.cpp
  clipboard_format_equivalence.cpp
  clipboard_format_receipt_tests.cpp
  clipboard_format_receipts.cpp
  clipboard_format_receipts_json.cpp
  clipboard_formats.cpp
  clipboard_gdi.cpp
  clipboard_html.cpp
  clipboard_isolation.cpp
  clipboard_native_api.cpp
  clipboard_native_formats.cpp
  clipboard_png_tests.cpp
  clipboard_png_wic.cpp
  clipboard_policy_tests.cpp
  clipboard_prepared_format.cpp
  clipboard_probe.cpp
  clipboard_publish.cpp
  clipboard_publish_tests.cpp
  clipboard_publish_verification.cpp
  clipboard_receipt_hash.cpp
  clipboard_reparse_fixture.cpp
  clipboard_reparse_tests.cpp
  clipboard_self_test.cpp
  clipboard_self_test_comparison.cpp
  clipboard_self_test_fixtures.cpp
  clipboard_self_test_native.cpp
  clipboard_self_test_registry.cpp
  clipboard_self_test_report.cpp
  clipboard_tiff_fixture.cpp
  clipboard_tiff_tests.cpp
  clipboard_tiff_wic.cpp
  clipboard_url_formats.cpp
  clipboard_url_tests.cpp
  clipboard_wic_decode.cpp
  main.cpp
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

target_compile_features(clipboard-format-probe PRIVATE cxx_std_17)
target_compile_definitions(clipboard-format-probe PRIVATE
  UNICODE
  _UNICODE
  WIN32_LEAN_AND_MEAN
  NOMINMAX
  _WIN32_WINNT=0x0A00
  WINVER=0x0A00
)
target_compile_options(clipboard-format-probe PRIVATE /W4 /utf-8 /permissive- /EHsc)
target_link_libraries(clipboard-format-probe PRIVATE
  User32
  Bcrypt
  Advapi32
  Gdi32
  windowscodecs
  ole32
)
