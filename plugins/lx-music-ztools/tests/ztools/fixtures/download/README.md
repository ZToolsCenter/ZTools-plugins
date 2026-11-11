These small audio fixtures were generated locally for download/metadata regression tests with FFmpeg's built-in sine source (440Hz, 44100Hz, 0.25 seconds). They contain no third-party recording. The tests decode before/after tagging to PCM s16le and compare SHA256, separately from metadata-parser assertions.

Generation commands:

    ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100:duration=0.25 -c:a libmp3lame -b:a 128k -write_xing 0 -map_metadata -1 tone.mp3
    ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100:duration=0.25 -c:a flac -map_metadata -1 tone.flac
