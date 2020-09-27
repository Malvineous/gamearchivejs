/**
 * @file F.A.S.T engine .DAT format handler.
 *
 * This file format is fully documented on the ModdingWiki:
 *   http://www.shikadi.net/moddingwiki/DAT_Format_%28Monster_Bash%29
 *
 * Copyright (C) 2018-2019 Adam Nielsen <malvineous@shikadi.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const { RecordBuffer, RecordType } = require('@malvineous/record-io-buffer');
const GameCompression = require('@malvineous/gamecomp');

const ArchiveHandler = require('./archiveHandler.js');
const Archive = require('./archive.js');
const Debug = require('../util/utl-debug.js');

const FORMAT_ID = 'arc-dat-fast';

const recordTypes = {
	fatEntry: {
		typeCode: RecordType.int.u16le,
		compressedSize: RecordType.int.u16le,
		name: RecordType.string.fixed.reqTerm(31),
		decompressedSize: RecordType.int.u16le, // 0 if not compressed
	},
};

const FATENTRY_LEN = 37; // sizeof(fatEntry)

/// Safety limit, actual format is unlimited
const MAX_FILES = 1024;

const FASTTypes = {
	0: ['.mif', 'map/fast-info'],
	1: ['.mbg', 'map/fast-bg'],
	2: ['.mfg', 'map/fast-fg'],
	3: ['.tbg', 'tileset/fast-4p'],
	4: ['.tfg', 'tileset/fast-5p'],
	5: ['.tbn', 'tileset/fast-5p'],
	6: ['.sgl', 'map/fast-spritelist'],
	7: ['.msp', 'map/fast-sprites'],
	8: ['', 'sound/inverse'],
	12: ['.pbg', 'data/fast-tileprops'],
	13: ['.pfg', 'data/fast-tileprops'],
	14: ['.pal', 'palette/ega'],
	16: ['.pbn', 'data/fast-tileprops'],
	32: ['', undefined],
	64: ['.spr', 'image/fast-sprite'],
};

const cmpDefaultParams = {
	initialBits: 9,
	maxBits: 12,
	cwEOF: 256,
	cwFirst: 257,
	bigEndian: false,
	flushOnReset: false,
};

module.exports = class Archive_DAT_FAST extends ArchiveHandler
{
	static metadata() {
		let md = {
			...super.metadata(),
			id: FORMAT_ID,
			title: 'F.A.S.T. Data File',
			games: [
				'Monster Bash',
			],
			glob: [
				'*.dat',
			],
		};

		// Files can optionally be compressed.
		md.caps.file.attributes.compressed = true;

		md.caps.file.maxFilenameLen = 30;

		return md;
	}

	static identify(content) {
		try {
			Debug.push(FORMAT_ID, 'identify');

			let buffer = new RecordBuffer(content);

			for (let i = 0; i < MAX_FILES; i++) {
				// If we're exactly at the EOF then we're done.
				const bytesLeft = buffer.distFromEnd();
				if (bytesLeft === 0) {
					Debug.log(`EOF at correct place => true`);
					return true;
				}

				if (bytesLeft < FATENTRY_LEN) {
					Debug.log(`Incomplete FAT entry => false`);
					return false;
				}

				const file = buffer.readRecord(recordTypes.fatEntry);
				if ([...file.name].some(c => {
					const cc = c.charCodeAt(0);
					return (cc <= 32) || (cc > 126);
				})) {
					// One or more filenames contain invalid chars, so they probably aren't
					// filenames.
					Debug.log(`File ${i} contains invalid char [${file.name}] => false`);
					return false;
				}
				if (buffer.distFromEnd() < file.compressedSize) {
					// This file apparently goes past the end of the archive
					Debug.log(`File ${i} would go past EOF => false`);
					return false;
				}
				buffer.seekRel(file.compressedSize);
			}
			// Too many files
			Debug.log(`Too many files => false`);
			return false;

		} finally {
			Debug.pop();
		}
	}

	static parse({main: content}) {
		let archive = new Archive();
		const cmpLZW = GameCompression.getHandler('cmp-lzw');
		const cmpRLE = GameCompression.getHandler('cmp-rle-bash');

		let buffer = new RecordBuffer(content);

		let nextOffset = FATENTRY_LEN;
		for (let i = 0; i < MAX_FILES; i++) {
			// If we're exactly at the EOF then we're done.
			if (buffer.distFromEnd() === 0) break;
			// TODO: Handle trailing data less than a FAT entry in size
			const fatEntry = buffer.readRecord(recordTypes.fatEntry);
			let offset = nextOffset; // copy inside closure for f.get()

			let file = new Archive.File();
			file.diskSize = fatEntry.compressedSize;
			file.offset = offset;

			// Convert the file type code into a filename extension if needed.
			const tc = FASTTypes[fatEntry.typeCode];
			if (tc) {
				file.name = fatEntry.name + tc[0];
				file.type = tc[1];
			} else {
				file.name = fatEntry.name;
				file.type = undefined;
			}

			file.getRaw = () => buffer.getU8(offset, file.diskSize);
			if (fatEntry.decompressedSize === 0) { // file is not compressed
				file.nativeSize = file.diskSize;
				file.attributes.compressed = false;

			} else { // file is compressed
				file.nativeSize = fatEntry.decompressedSize;
				file.attributes.compressed = true;

				// Override getContent() to decompress the file first.
				file.getContent = () => {
					const fileParams = {
						...cmpDefaultParams,
						// Some files have trailing bytes so we'll allocate a little extra
						// memory to avoid a buffer resize right at the end.
						finalSize: fatEntry.nativeSize + 16,
					};
					// Decompress with LZW, then decode with RLE.
					const decomp = cmpRLE.reveal(
						cmpLZW.reveal(file.getRaw(), fileParams)
					);

					// Since the compression algorithm often leaves an extra null byte
					// at the end of the data, we need to truncate it to the size given in
					// the file header.
					return decomp.slice(0, file.nativeSize);
				};
			}

			archive.files.push(file);

			// All done, go to the next file.
			nextOffset += fatEntry.compressedSize + FATENTRY_LEN;
			buffer.seekRel(fatEntry.compressedSize);
		}

		return archive;
	}

	static generate(archive)
	{
		const cmpLZW = GameCompression.getHandler('cmp-lzw');
		const cmpRLE = GameCompression.getHandler('cmp-rle-bash');

		// Calculate the size up front so we don't have to keep reallocating the
		// buffer, improving performance.
		const finalSize = archive.files.reduce(
			(a, b) => a + (b.nativeSize || 0),
			FATENTRY_LEN * archive.files.length
		);

		let buffer = new RecordBuffer(finalSize);

		archive.files.forEach(file => {
			const entry = {
				typeCode: 32,
				name: file.name,
			};
			const ext = entry.name.substr(-4).toLowerCase();
			if (ext === '.snd') { // special case
				entry.typeCode = 8;
				// extension isn't removed
			} else {
				Object.keys(FASTTypes).some(typeCode => {
					if (FASTTypes[typeCode][0] === '') return false;
					if (ext === FASTTypes[typeCode][0]) {
						entry.typeCode = typeCode;
						// Remove filename extension
						entry.name = entry.name.substr(0, entry.name.length-4);
						return true;
					}
					return false; // keep going
				});
			}

			const nativeData = file.getContent();

			// Safety check.
			if (nativeData.length != file.nativeSize) {
				throw new Error('Length of data and nativeSize field do not match!');
			}

			let diskData;
			if (file.attributes.compressed === false) { // compression not wanted
				diskData = nativeData;

				// Files that aren't compressed have the decompressed size set to 0 in
				// this archive format.
				entry.decompressedSize = 0;
				entry.compressedSize = file.nativeSize;
			} else { // compression wanted or don't care/default
				// Compress the file
				diskData = cmpLZW.obscure(
					cmpRLE.obscure(nativeData),
					cmpDefaultParams
				);

				// Set the size of the decompressed data in the header
				entry.decompressedSize = file.nativeSize;
				entry.compressedSize = diskData.length;
			}

			buffer.writeRecord(recordTypes.fatEntry, entry);
			buffer.put(diskData);
		});

		return {
			main: buffer.getU8(),
		};
	}

};
