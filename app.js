const http = require('https');
const zlib = require('zlib');
const fs = require('fs');
const util = require('util');
const ZipEntriesReader = require('./zip.js');
const crypto = require('crypto');
const readFile = util.promisify(fs.readFile);

let OUTPUT = "./output.txt";

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
			const responseParser = new PackEntries();
			responseParser.on('data', (data) => result.push(data));
			responseParser.on('finish', () => resolve(result)); 
			responseParser.on('error', (err) => reject(err));
			response.pipe(responseParser);
			response.on('error', (err) => reject(err));
		});
	}
}

async function main() {
	const [inputPath, outputPath, showErrors] = processArguments(process.argv);
	console.log(`Loading list from ${inputPath}, saving result in ${outputPath} ...`);
	const contents = (await readFile(inputPath)).toString('utf8');
	const fileEntries = contents.split('\n');
	const output = fs.createWriteStream(outputPath, { flags: 'a' });
	console.time('Fetching');
	for (let fileEntry of fileEntries) {
		const [fileName, fileUrl] = fileEntry.split(/\s(?=http)/);
		console.log(`    fetching ${fileName} ...`);
		const fetcher = new FileFetcher({ url: fileUrl });
		try {
			const hashes = await fetcher.fetch();
			if (hashes.length) {
				for (let hash of hashes) {
					console.log(`        ${hash.toString('ascii').split(/\s/)[0]}`);
				}
				output.write(Buffer.concat(hashes));
			}
			else {
				console.log('        no pk3 files found');
			}
		}
		catch (err) {
			if (showErrors) console.log(err);
			console.log('       failed');
		}
	}
	console.log('The task is finished.');
	console.timeEnd('Fetching');
}

function processArguments(cmdline) {
	let inputPath = "";
	let outputPath = OUTPUT;
	let showErrors = false;
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
		else if (arg === "--errors") {
			showErrors = true;
		}
	}

	if (!inputPath) {
		const help = [
			'usage: app.js --input <list-path> [--output <output-path>] [--errors]',
			'example: $ node ./app.js --input files-maps.txt --output filehashes.txt',
			'options:',
			'  --input   input file path containing the list of download links',
			'  --ouput   output file path, where the result is going to be stored, defaults to output.txt',
			'  --errors  prints all errors, that are usually skipped'
		];
		console.log(help.join('\n'));
		process.exit(0);
	}

	return [inputPath, outputPath, showErrors];
}

main();

process.on('unhandledRejection', error => {
	console.log('unhandledRejection', error.message);
});
