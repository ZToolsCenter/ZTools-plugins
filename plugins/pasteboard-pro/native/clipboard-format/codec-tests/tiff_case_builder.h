#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace clipboard_codecs::tiff_test {

class TiffBuilder {
 public:
  explicit TiffBuilder(bool big_endian = false);

  int AddDirectory();
  int AddImageData(std::vector<std::uint8_t> bytes);
  void AddNumbers(int directory, std::uint16_t tag, std::uint16_t type,
                  std::vector<std::uint32_t> values);
  void AddBytes(int directory, std::uint16_t tag, std::uint16_t type,
                std::vector<std::uint8_t> bytes);
  void AddDirectoryReferences(int directory, std::uint16_t tag,
                              std::uint16_t type,
                              std::vector<int> targets);
  void AddImageOffsets(int directory, std::uint16_t tag, std::uint16_t type,
                       std::vector<int> image_indices);
  void SetNext(int directory, int target);

  std::vector<std::uint8_t> Build(int root_directory = 0);
  std::uint32_t IfdOffset(int directory) const;
  std::uint64_t EntryOffset(int directory, std::uint16_t tag) const;
  bool big_endian() const { return big_endian_; }

 private:
  struct Tag {
    std::uint16_t id = 0;
    std::uint16_t type = 0;
    std::vector<std::uint32_t> numbers;
    std::vector<std::uint8_t> bytes;
    std::vector<int> directory_targets;
    std::vector<int> image_targets;
    bool use_directory_targets = false;
    bool use_image_targets = false;
  };

  struct Directory {
    std::vector<Tag> tags;
    int next = -1;
  };

  std::uint32_t ValueCount(const Tag& tag) const;
  std::uint8_t ValueWidth(std::uint16_t type) const;
  void Put16(std::vector<std::uint8_t>* bytes, std::size_t offset,
             std::uint16_t value) const;
  void Put32(std::vector<std::uint8_t>* bytes, std::size_t offset,
             std::uint32_t value) const;
  void PutValue(std::vector<std::uint8_t>* bytes, std::size_t offset,
                std::uint16_t type, std::uint32_t value) const;
  std::vector<std::uint8_t> EncodeTag(const Tag& tag,
                                      const std::vector<std::uint32_t>& ifd_offsets,
                                      const std::vector<std::uint32_t>& image_offsets) const;

  bool big_endian_ = false;
  std::vector<Directory> directories_;
  std::vector<std::vector<std::uint8_t>> image_data_;
  std::vector<std::uint32_t> last_ifd_offsets_;
};

struct RasterOptions {
  std::uint32_t width = 1;
  std::uint32_t height = 1;
  std::vector<std::uint32_t> bits_per_sample = {8};
  std::uint32_t samples_per_pixel = 1;
  std::uint32_t compression = 1;
  std::uint32_t rows_per_strip = 0;
  bool tiled = false;
  std::uint32_t tile_width = 1;
  std::uint32_t tile_height = 1;
  std::uint32_t planar_configuration = 1;
  std::uint32_t photometric_interpretation = 1;
  std::vector<std::uint32_t> extra_samples;
  bool include_photometric = true;
  bool include_compression = true;
};

int AddRasterDirectory(TiffBuilder* builder, const RasterOptions& options,
                       const std::vector<int>& image_indices,
                       const std::vector<std::uint32_t>& byte_counts);

}  // namespace clipboard_codecs::tiff_test
