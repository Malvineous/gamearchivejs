/**
 * @file Main library interface.
 *
 * Copyright (C) 2010-2021 Adam Nielsen <malvineous@shikadi.net>
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

const Debug = require('./util/utl-debug.js');

const fileTypes = [
	// These file formats all have signatures so the autodetection is
	// fast and they are listed first.
	require('./formats/arc-bnk-harry.js'),
	require('./formats/arc-epf-eastpoint.js'),
	require('./formats/arc-glb-raptor.js'),
	require('./formats/arc-grp-build.js'),
	require('./formats/arc-hog-descent.js'),
	...require('./formats/arc-rff-blood.js'),
	require('./formats/arc-wad-doom.js'),
	require('./formats/arc-fixed-ddave_exe.js'),

	// These formats require enumeration, sometimes all the way to the
	// end of the file, so they are next.
	require('./formats/arc-dat-fast.js'),
	require('./formats/arc-dat-wacky.js'),
	require('./formats/arc-pod-tv.js'),
	require('./formats/arc-vol-cosmo.js'),
	require('./formats/arc-lbr-vinyl.js'),

	// These formats are so ambiguous that they are often misidentified,
	// so they are last.
	// Coming soon :)
];

/**
 * Main library interface.
 */
module.exports = class GameArchive
{
	/**
	 * Get a handler by ID directly.
	 *
	 * @param {string} type
	 *   Identifier of desired file format.
	 *
	 * @return {ArchiveHandler} from formats/*.js matching requested code, or null
	 *   if the code is invalid.
	 *
	 * @example const handler = GameArchive.getHandler('arc-grp-build');
	 */
	static getHandler(type)
	{
		return fileTypes.find(x => type === x.metadata().id);
	}

	/**
	 * Get a handler by examining the file content.
	 *
	 * @param {Uint8Array} content
	 *   Archive file content.
	 *
	 * @param {string} filename
	 *   Filename where `content` was read from.  This is required to identify
	 *   formats where the filename extension is significant.  This can be
	 *   omitted for less accurate autodetection.
	 *
	 * @return {Array<ArchiveHandler>} from formats/*.js that can handle the
	 *   format, or an empty array if the format could not be identified.
	 *
	 * @example
	 * const content = fs.readFileSync('duke3d.grp');
	 * const handler = GameArchive.findHandler(content, 'duke3d.grp');
	 * if (handler.length === 0) {
	 *   console.log('Unable to identify file format.');
	 * } else {
	 *   const md = handler[0].metadata();
	 *   console.log('File is in ' + md.id + ' format');
	 * }
	 */
	static findHandler(content, filename)
	{
		const debug = Debug.extend('findHandler');
		debug('Autodetecting file format');

		if (content.length === undefined) {
			throw new Error('content parameter must be Uint8Array');
		}
		let handlers = [];
		for (const x of fileTypes) {
			const metadata = x.metadata();
			const confidence = x.identify(content, filename);
			if (confidence.valid === true) {
				debug(`Matched ${metadata.id}: ${confidence.reason}`);
				handlers = [x];
				break;
			} else if (confidence.valid === undefined) {
				debug(`Possible match for ${metadata.id}: ${confidence.reason}`);
				handlers.push(x);
				// keep going to look for a better match
			} else {
				debug(`Not ${metadata.id}: ${confidence.reason}`);
			}
		}
		return handlers;
	}

	/**
	 * Get a list of all the available handlers.
	 *
	 * This is probably only useful when testing the library.
	 *
	 * @return {Array} of file format handlers, with each element being just like
	 *   the return value of getHandler().
	 */
	static listHandlers() {
		return fileTypes;
	}
};

module.exports.Archive = require('./formats/archive.js');
