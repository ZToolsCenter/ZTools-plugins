#include "tiff_case_builder.h"

#include <algorithm>
#include <limits>
#include <utility>

namespace clipboard_codecs::tiff_test {
namespace {

void AppendValue(std::vector<std::uint8_t>* output, std::uint16_t type,
                 std::uint32_t value, bool big_endian) {
  const std::size_t width =
      type == 1 || type == 2 || type == 6 || type == 7
          ? 1
          : (type == 3 || type == 8 ? 2 : 4);
  if (width == 1) {
    output->push_back(static_cast<std::uint8_t>(value));
  } else if (width == 2) {
    if (big_endian) {
      output->push_back(static_cast<std::uint8_t>(value >> 8));
      output->push_back(static_cast<std::uint8_t>(value));
    } else {
      output->push_back(static_cast<std::uint8_t>(value));
      output->push_back(static_cast<std::uint8_t>(value >> 8));
    }
  } else if (big_endian) {
    output->push_back(static_cast<std::uint8_t>(value >> 24));
    output->push_back(static_cast<std::uint8_t>(value >> 16));
    output->push_back(static_cast<std::uint8_t>(value >> 8));
    output->push_back(static_cast<std::uint8_t>(value));
  } else {
    output->push_back(static_cast<std::uint8_t>(value));
    output->push_back(static_cast<std::uint8_t>(value >> 8));
    output->push_back(static_cast<std::uint8_t>(value >> 16));
    output->push_back(static_cast<std::uint8_t>(value >> 24));
  }
}

}  // namespace

TiffBuilder::TiffBuilder(bool big_endian) : big_endian_(big_endian) {}

int TiffBuilder::AddDirectory() {
  directories_.push_back({});
  return static_cast<int>(directories_.size() - 1);
}

int TiffBuilder::AddImageData(std::vector<std::uint8_t> bytes) {
  image_data_.push_back(std::move(bytes));
  return static_cast<int>(image_data_.size() - 1);
}

void TiffBuilder::AddNumbers(int directory, std::uint16_t tag,
                             std::uint16_t type,
                             std::vector<std::uint32_t> values) {
  Tag field;
  field.id = tag;
  field.type = type;
  field.numbers = std::move(values);
  directories_.at(static_cast<std::size_t>(directory)).tags.push_back(
      std::move(field));
}

void TiffBuilder::AddBytes(int directory, std::uint16_t tag,
                           std::uint16_t type,
                           std::vector<std::uint8_t> bytes) {
  Tag field;
  field.id = tag;
  field.type = type;
  field.bytes = std::move(bytes);
  directories_.at(static_cast<std::size_t>(directory)).tags.push_back(
      std::move(field));
}

void TiffBuilder::AddDirectoryReferences(int directory, std::uint16_t tag,
                                         std::uint16_t type,
                                         std::vector<int> targets) {
  Tag field;
  field.id = tag;
  field.type = type;
  field.directory_targets = std::move(targets);
  field.use_directory_targets = true;
  directories_.at(static_cast<std::size_t>(directory)).tags.push_back(
      std::move(field));
}

void TiffBuilder::AddImageOffsets(int directory, std::uint16_t tag,
                                  std::uint16_t type,
                                  std::vector<int> image_indices) {
  Tag field;
  field.id = tag;
  field.type = type;
  field.image_targets = std::move(image_indices);
  field.use_image_targets = true;
  directories_.at(static_cast<std::size_t>(directory)).tags.push_back(
      std::move(field));
}

void TiffBuilder::SetNext(int directory, int target) {
  directories_.at(static_cast<std::size_t>(directory)).next = target;
}

std::uint8_t TiffBuilder::ValueWidth(std::uint16_t type) const {
  switch (type) {
    case 1:
    case 2:
    case 6:
    case 7:
      return 1;
    case 3:
    case 8:
      return 2;
    case 4:
    case 9:
    case 11:
    case 13:
      return 4;
    case 5:
    case 10:
    case 12:
      return 8;
    default:
      return 0;
  }
}

std::uint32_t TiffBuilder::ValueCount(const Tag& tag) const {
  if (tag.use_directory_targets) {
    return static_cast<std::uint32_t>(tag.directory_targets.size());
  }
  if (tag.use_image_targets) {
    return static_cast<std::uint32_t>(tag.image_targets.size());
  }
  if (!tag.bytes.empty()) {
    const auto width = ValueWidth(tag.type);
    return width == 0 ? 0 : static_cast<std::uint32_t>(tag.bytes.size() / width);
  }
  return static_cast<std::uint32_t>(tag.numbers.size());
}

void TiffBuilder::Put16(std::vector<std::uint8_t>* bytes, std::size_t offset,
                        std::uint16_t value) const {
  if (big_endian_) {
    (*bytes)[offset] = static_cast<std::uint8_t>(value >> 8);
    (*bytes)[offset + 1] = static_cast<std::uint8_t>(value);
  } else {
    (*bytes)[offset] = static_cast<std::uint8_t>(value);
    (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
  }
}

void TiffBuilder::Put32(std::vector<std::uint8_t>* bytes, std::size_t offset,
                        std::uint32_t value) const {
  for (std::size_t byte = 0; byte < 4; ++byte) {
    const auto shift = big_endian_ ? (3 - byte) * 8 : byte * 8;
    (*bytes)[offset + byte] =
        static_cast<std::uint8_t>((value >> shift) & 0xff);
  }
}

void TiffBuilder::PutValue(std::vector<std::uint8_t>* bytes,
                           std::size_t offset, std::uint16_t type,
                           std::uint32_t value) const {
  const auto width = ValueWidth(type);
  if (width == 1) {
    (*bytes)[offset] = static_cast<std::uint8_t>(value);
  } else if (width == 2) {
    Put16(bytes, offset, static_cast<std::uint16_t>(value));
  } else {
    Put32(bytes, offset, value);
  }
}

std::vector<std::uint8_t> TiffBuilder::EncodeTag(
    const Tag& tag, const std::vector<std::uint32_t>& ifd_offsets,
    const std::vector<std::uint32_t>& image_offsets) const {
  if (!tag.bytes.empty()) return tag.bytes;
  std::vector<std::uint8_t> output;
  if (tag.use_directory_targets) {
    for (int target : tag.directory_targets) {
      AppendValue(&output, tag.type,
                  target < 0 ? 0 : ifd_offsets.at(static_cast<std::size_t>(target)),
                  big_endian_);
    }
  } else if (tag.use_image_targets) {
    for (int target : tag.image_targets) {
      AppendValue(&output, tag.type,
                  target < 0
                      ? 0
                      : image_offsets.at(static_cast<std::size_t>(target)),
                  big_endian_);
    }
  } else {
    for (std::uint32_t value : tag.numbers) {
      AppendValue(&output, tag.type, value, big_endian_);
    }
  }
  return output;
}

std::vector<std::uint8_t> TiffBuilder::Build(int root_directory) {
  if (directories_.empty() || root_directory < 0 ||
      static_cast<std::size_t>(root_directory) >= directories_.size()) {
    return {};
  }
  for (auto& directory : directories_) {
    std::stable_sort(directory.tags.begin(), directory.tags.end(),
                     [](const Tag& left, const Tag& right) {
                       return left.id < right.id;
                     });
  }
  std::vector<std::uint32_t> ifd_offsets(directories_.size());
  std::uint64_t ifd_cursor = 8;
  for (std::size_t index = 0; index < directories_.size(); ++index) {
    if (directories_[index].tags.empty() ||
        directories_[index].tags.size() > UINT16_MAX) {
      return {};
    }
    ifd_offsets[index] = static_cast<std::uint32_t>(ifd_cursor);
    ifd_cursor += 6 + directories_[index].tags.size() * 12;
  }

  std::vector<std::vector<std::uint64_t>> payload_offsets(
      directories_.size());
  std::uint64_t payload_cursor = ifd_cursor;
  for (std::size_t directory = 0; directory < directories_.size(); ++directory) {
    payload_offsets[directory].resize(directories_[directory].tags.size(), 0);
    for (std::size_t tag_index = 0;
         tag_index < directories_[directory].tags.size(); ++tag_index) {
      const Tag& tag = directories_[directory].tags[tag_index];
      const std::uint64_t length =
          static_cast<std::uint64_t>(ValueCount(tag)) * ValueWidth(tag.type);
      if (length > 4) {
        if ((payload_cursor & 1u) != 0) ++payload_cursor;
        payload_offsets[directory][tag_index] = payload_cursor;
        payload_cursor += length;
      }
    }
  }

  std::vector<std::uint32_t> image_offsets(image_data_.size());
  std::uint64_t image_cursor = payload_cursor;
  for (std::size_t index = 0; index < image_data_.size(); ++index) {
    image_offsets[index] = static_cast<std::uint32_t>(image_cursor);
    image_cursor += image_data_[index].size();
  }
  if (image_cursor > std::numeric_limits<std::size_t>::max() ||
      image_cursor > UINT32_MAX) {
    return {};
  }

  std::vector<std::uint8_t> output(static_cast<std::size_t>(image_cursor), 0);
  if (big_endian_) {
    output[0] = 'M';
    output[1] = 'M';
  } else {
    output[0] = 'I';
    output[1] = 'I';
  }
  Put16(&output, 2, 42);
  Put32(&output, 4, ifd_offsets[static_cast<std::size_t>(root_directory)]);

  for (std::size_t directory = 0; directory < directories_.size(); ++directory) {
    const auto& spec = directories_[directory];
    const std::size_t offset = ifd_offsets[directory];
    Put16(&output, offset, static_cast<std::uint16_t>(spec.tags.size()));
    const std::size_t entries_start = offset + 2;
    for (std::size_t index = 0; index < spec.tags.size(); ++index) {
      const Tag& tag = spec.tags[index];
      const std::size_t entry = entries_start + index * 12;
      const std::uint32_t count = ValueCount(tag);
      Put16(&output, entry, tag.id);
      Put16(&output, entry + 2, tag.type);
      Put32(&output, entry + 4, count);

      const std::vector<std::uint8_t> value =
          EncodeTag(tag, ifd_offsets, image_offsets);
      const std::uint64_t value_bytes =
          static_cast<std::uint64_t>(count) * ValueWidth(tag.type);
      if (value.size() != value_bytes) return {};
      if (value_bytes <= 4) {
        std::copy(value.begin(), value.end(), output.begin() + entry + 8);
      } else {
        const std::uint64_t data_offset = payload_offsets[directory][index];
        Put32(&output, entry + 8, static_cast<std::uint32_t>(data_offset));
        std::copy(value.begin(), value.end(),
                  output.begin() + static_cast<std::size_t>(data_offset));
      }
    }
    const std::size_t next_location =
        entries_start + spec.tags.size() * 12;
    const std::uint32_t next =
        spec.next < 0 ? 0 : ifd_offsets.at(static_cast<std::size_t>(spec.next));
    Put32(&output, next_location, next);
  }

  for (std::size_t index = 0; index < image_data_.size(); ++index) {
    std::copy(image_data_[index].begin(), image_data_[index].end(),
              output.begin() + image_offsets[index]);
  }
  last_ifd_offsets_ = std::move(ifd_offsets);
  return output;
}

std::uint32_t TiffBuilder::IfdOffset(int directory) const {
  return last_ifd_offsets_.at(static_cast<std::size_t>(directory));
}

std::uint64_t TiffBuilder::EntryOffset(int directory,
                                       std::uint16_t tag_id) const {
  const auto directory_index = static_cast<std::size_t>(directory);
  const std::uint64_t start = last_ifd_offsets_.at(directory_index) + 2;
  const auto& tags = directories_.at(directory_index).tags;
  for (std::size_t index = 0; index < tags.size(); ++index) {
    if (tags[index].id == tag_id) return start + index * 12;
  }
  return UINT64_MAX;
}

int AddRasterDirectory(TiffBuilder* builder, const RasterOptions& options,
                       const std::vector<int>& image_indices,
                       const std::vector<std::uint32_t>& byte_counts) {
  if (builder == nullptr || image_indices.empty() ||
      image_indices.size() != byte_counts.size()) {
    return -1;
  }
  const int directory = builder->AddDirectory();
  builder->AddNumbers(directory, 256, 4, {options.width});
  builder->AddNumbers(directory, 257, 4, {options.height});
  builder->AddNumbers(directory, 258, 3, options.bits_per_sample);
  if (options.include_compression) {
    builder->AddNumbers(directory, 259, 3, {options.compression});
  }
  if (options.include_photometric) {
    builder->AddNumbers(directory, 262, 3,
                        {options.photometric_interpretation});
  }
  builder->AddNumbers(directory, 277, 3, {options.samples_per_pixel});
  builder->AddNumbers(directory, 284, 3, {options.planar_configuration});
  if (!options.extra_samples.empty()) {
    builder->AddNumbers(directory, 338, 3, options.extra_samples);
  }
  if (options.tiled) {
    builder->AddNumbers(directory, 322, 4, {options.tile_width});
    builder->AddNumbers(directory, 323, 4, {options.tile_height});
    builder->AddImageOffsets(directory, 324, 4, image_indices);
    builder->AddNumbers(directory, 325, 4, byte_counts);
  } else {
    builder->AddNumbers(directory, 278, 4,
                        {options.rows_per_strip == 0
                             ? options.height
                             : options.rows_per_strip});
    builder->AddImageOffsets(directory, 273, 4, image_indices);
    builder->AddNumbers(directory, 279, 4, byte_counts);
  }
  return directory;
}

}  // namespace clipboard_codecs::tiff_test
