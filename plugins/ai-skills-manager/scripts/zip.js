import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

const output = fs.createWriteStream(path.join(process.cwd(), 'ai-skills-manager.zip'));
const archive = archiver('zip', {
  zlib: { level: 9 } // Sets the compression level.
});

output.on('close', function() {
  console.log(archive.pointer() + ' total bytes');
  console.log('Archiver has been finalized and the output file descriptor has closed.');
});

archive.on('warning', function(err) {
  if (err.code === 'ENOENT') {
    console.warn(err);
  } else {
    throw err;
  }
});

archive.on('error', function(err) {
  throw err;
});

archive.pipe(output);

// Append files from dist directory
archive.directory('dist/', false);

archive.finalize();
