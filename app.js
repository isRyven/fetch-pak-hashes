const http = require('https');
const zlib = require('zlib');
const fs = require('fs');
const util = require('util');
const ZipEntriesReader = require('./zip.js');
const crypto = require('crypto');
const readFile = util.promisify(fs.readFile);

let OUTPUT = "./output.txt";
let INPUT = "./files.txt";

class PackEntries extends ZipEntriesReader {

	constructor(options) {
		super(options);
	}

	async process(entries) {
		for (let entry of entries) {
			// skips entries with empty crc32 (directories, empty files)
			if (entry.crc32.readInt32LE() != 0) {
				const fileName = entry.fileName.toString(); 
				if (fileName.endsWith('.pk3')) {
					try {
						this.push(await this._processPak(fileName, entry.data));
					}
					catch (err) {
						console.error(err);
					}
				}
			}
		}
	}
	_processPak(name, data) {
		return new Promise((resolve, reject) => {
			const buffer = zlib.inflateRaw(data, (err, buffer) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(Buffer.from(`${name} ${crypto.createHash('sha1').update(buffer).digest('hex')}\n`));
			});
		});
	}
}

class FileFetcher {
	constructor({ url }) {
		this._url = url;
		this._handleResponse = this._handleResponse.bind(this);
	}

	async fetch() {
		const response = await this._handleRequest(this._url);
		return await this._handleResponse(response);
	}
	
	_handleRequest(url) {
		return new Promise((resolve, reject) => {
			http.get(url, async (response) => {
				if (response.headers.location) {
					resolve(await this._handleRequest(response.headers.location));
				} else {
					if (response.statusCode != 200) {
						reject(new Error(`[${response.statusCode}] Could not fetch the file: ${url}`));
						return;
					}
					resolve(response);
				}
			}).on('error', err => reject(err));
		});
	}
	_handleResponse(response) {
		return new Promise((resolve, reject) => {
			const result = [];
			response.pipe(new PackEntries()).on('data', (data) => result.push(data));
			response.on('error', err => reject(err));
			response.on('close', () => resolve(result));
		});
	}
}

async function main() {
	const [inputPath, outputPath] = processArguments(process.argv);
	console.log(`Loading list from ${inputPath}, saving result in ${outputPath} ...`);
	const contents = (await readFile(inputPath)).toString('utf8');
	const fileEntries = contents.split('\n');
	const output = fs.createWriteStream(outputPath, { flags: 'a' });
	console.time('Fetching');
	for (let fileEntry of fileEntries) {
		const [fileName, fileUrl] = fileEntry.split(/\s(?=https)/);
		process.stdout.write(`    fetching ${fileName} ...`);
		const fetcher = new FileFetcher({ url: fileUrl });
		try {
			const hashes = await fetcher.fetch();
			if (hashes.length) output.write(Buffer.concat(hashes));
			process.stdout.write(' [done]\n');
		}
		catch (err) {
			// console.log(err);
			process.stdout.write(' [fail]\n');
		}
	}
	console.log('The task is finished.');
	console.timeEnd('Fetching');
}

function processArguments(cmdline) {
	let inputPath = INPUT;
	let outputPath = OUTPUT;
	let args = cmdline.slice(2);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--input") {
			if (args[i + 1] && !args[i +1 ].startsWith('--')) {
				inputPath = args[i + 1];
			}
		}
		else if (arg === "--output") {
			if (args[i + 1] && !args[i + 1].startsWith('--')) {
				outputPath = args[i + 1];
			}
		}
	}
	return [inputPath, outputPath];
}

main();
