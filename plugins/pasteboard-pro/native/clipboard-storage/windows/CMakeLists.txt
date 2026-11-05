cmake_minimum_required(VERSION 3.24)
project(pasteboard_windows_storage_foundation LANGUAGES CXX)
if(NOT WIN32)
  message(FATAL_ERROR "Windows SDK is required; this is not a portable or simulated native test")
endif()
add_executable(windows-storage-foundation
  private_security.cpp
  private_creation.cpp
  private_handles.cpp
  storage_probe.cpp
  storage_probe_report.cpp
  storage_probe_acl_cases.cpp
  storage_probe_link_cases.cpp
)
target_compile_features(windows-storage-foundation PRIVATE cxx_std_17)
target_compile_definitions(windows-storage-foundation PRIVATE
  UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _WIN32_WINNT=0x0A00)
if(NOT MSVC)
  message(FATAL_ERROR "This foundation probe currently requires the MSVC toolchain")
endif()
target_compile_options(windows-storage-foundation PRIVATE /W4 /utf-8 /EHsc)
target_link_libraries(windows-storage-foundation PRIVATE Advapi32 Bcrypt)
