const zlib = require('zlib');
const fs = require('fs');
const util = require('util');
const crypto = require('crypto');
const Path = require('path');
const EventEmitter = require('events');
const Utils = require('util');

const download = require('./download');
const ZipEntriesReader = require('./zip.js');

const readFile = util.promisify(fs.readFile);

const OUTPUT = "./output.txt";
const ERROR = 'ERROR';
const WARNING = 'WARNING';
const GENERAL = 'GENERAL';
const TAB1 = ' '.repeat(4);
const TAB2 = ' '.repeat(8);
const BLACK = '\u001b[30m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const BLUE = '\u001b[34m';
const MAGENTA = '\u001b[35m';
const CYAN = '\u001b[36m';
const WHITE = '\u001b[37m';
const RESET = '\u001b[0m';
const BRIGHTBLACK = '\u001b[30;1m';
const BRIGHTRED = '\u001b[31;1m';
const BRIGHTGREEN = '\u001b[32;1m';
const BRIGHTYELLOW = '\u001b[33;1m';
const BRIGHTBLUE = '\u001b[34;1m';
const BRIGHTMAGENTA = '\u001b[35;1m';
const BRIGHTCYAN = '\u001b[36;1m';
const BRIGHTWHITE = '\u001b[37;1m';
const ANSIESCAPEREGEX = /\u001b\[.*?m/g;

class PakEntriesReader extends ZipEntriesReader {
	constructor(options) {
		super(options);
	}
	async process(entries) {
		for (let entry of entries) {
			if (entry.crc32.readInt32LE() != 0) {
				const fileName = entry.fileName.toString(); 
				if (fileName.endsWith('.pk3')) {
					this.push(await this._processPak(Path.basename(fileName), entry.data));
				}
			}
		}
	}
	_processPak(name, data) {
		return new Promise((resolve, reject) => {
			zlib.inflateRaw(data, (err, buffer) => {
				if (err) return reject(err);
				resolve(Buffer.from(this._generateEntry(name, buffer)));
			});
		});
	}
	_generateEntry(name, buffer) {
		return `${name} ${crypto.createHash('sha1').update(buffer).digest('hex')}\n`;
	}
}

class ZipFetcher extends EventEmitter {
	constructor({ url }) {
		super();
		this._url = url;
	}

	async fetch() {
		return await this._download(this._url);
	}

	_download(url) {
		return new Promise(async (resolve, reject) => {
			const result = [];
			const reader = new PakEntriesReader();
			reader.on('data', (data) => result.push(data));
			reader.on('finish', () => resolve(result));
			reader.on('error', (err) => reject(err));
			try {
				await download(
					url,
					reader,
					(progress, total) => this.emit('progress', { progress, total }),
					(type) => type === 'application/zip' || type === "application/octet-stream"
				);
			}
			catch (err) {
				reject(err);
			}
		});
	}
}

function humanFileSize(size) {
	if (typeof size !== 'number') return size;
    var e = (Math.log(size) / Math.log(1e3)) | 0;
    return Number((size / Math.pow(1e3, e))).toFixed(2) + ' ' + ('kMGTPEZY'[e - 1] || '') + 'B';
}
function drawProgress(value, total) {
	if (total === 0) total = 'N/A';
	process.stdout.write("\u001b[2K\r");
	process.stdout.write(`${TAB2}${CYAN}downloading: ${BRIGHTCYAN}${humanFileSize(value)} / ${humanFileSize(total)}${RESET}`);
}
function clearAnsiCodes(val) {
	return typeof val === 'string' ? val.replace(ANSIESCAPEREGEX, '') : val;
}
function createLogger(outputStream, { printErrors = false }) {
	return function (level, ...msgs) {
		switch (level) {
			case ERROR: {
				if (printErrors) {
					console.error(...msgs);
				}
				break;
			}
			case WARNING: {
				console.warn(...msgs);
				break;
			}
			case GENERAL:
			default: {
				console.log(...msgs);
			}
		}
	
		if (outputStream) outputStream.write(`${Utils.format(...msgs.map(clearAnsiCodes))}\n`);
	}
}

async function main() {
	const [inputPath, outputPath, showErrors, logProcess] = processArguments(process.argv);
	const logOutputPath = `./logs/log-${new Date().toISOString()}.txt`;
	let input, output, logOutput;
	
	console.log([
		`Input:   ${BRIGHTBLUE}${inputPath}${RESET}`,
		`Output:  ${BRIGHTBLUE}${outputPath}${RESET}`,
		`Errors:  ${BRIGHTBLUE}${showErrors ? 'Yes' : 'No'}${RESET}`,
		`Logging: ${BRIGHTBLUE}${logProcess ? 'Yes' : 'No'}${RESET} ${logProcess ? `(${logOutputPath})` : ''}`
	].join('\n'));

	try {
		input = (await readFile(inputPath)).toString('utf8');
	}
	catch (err) {
		console.log('Failied to open input file');
		console.error(err);
		process.exit(0);
	}
	
	try {
		output = fs.createWriteStream(outputPath, { flags: 'a' });
	}
	catch (err) {
		console.log('Failied to open output stream');
		console.error(err);
		process.exit(0);
	}

	if (logProcess) {
		try {
			logOutput = fs.createWriteStream(logOutputPath, { flags: 'a' });
		}
		catch (err) {
			console.log('Failied to open log stream');
			console.error(err);
			process.exit(0);
		}
	}
	
	let fileEntries = input.split('\n');
	let log = createLogger(logOutput, { printErrors: showErrors });

	process.on('unhandledRejection', (error) => {
		log(ERROR, `\n${RESET}[unhandledRejection]`);
		log(ERROR, error);
	});

	let numFailed = 0;
	let numAdded = 0;
	let failedList = [];
	
	console.time('Task time');
	log(GENERAL, '\n<The task has started>')
	for (let fileEntry of fileEntries) {
		if (!fileEntry) continue;
		
		const [fileName, fileUrl] = fileEntry.split(/\s(?=http)/);
		let fetcher = new ZipFetcher({ url: fileUrl });
		
		fetcher.addListener('progress', ({ progress, total }) => drawProgress(progress, total));
		
		try {
			log(GENERAL, TAB1 + `fetching ${GREEN}${fileName}${RESET} ...`);
			let hashes = await fetcher.fetch();
			process.stdout.write('\n');
			if (hashes.length) {
				for (let hash of hashes) {
					log(GENERAL, TAB2 + `${GREEN}[+] ${BRIGHTGREEN}${hash.toString('ascii').split(/\s/)[0]}${RESET}`);
				}
				output.write(Buffer.concat(hashes));
				numAdded += hashes.length;
			}
			else {
				log(WARNING, TAB2 + `${YELLOW}[-] ${BRIGHTYELLOW}No pk3 files found${RESET}`);
			}
		}
		catch (err) {
			process.stdout.write('\n');
			log(ERROR, TAB2 + `${RED}[!] ${BRIGHTRED}${err.message ? err.message : err}${RESET}`);
			numFailed++;
			failedList.push({ name: fileName, url: fileUrl, reason: err });
		}

		fetcher.removeAllListeners();
	}

	log(GENERAL, '<The task has finished>');
	console.timeEnd('Task time');

	log(GENERAL, '');
	log(GENERAL, `Found pk3: ${BRIGHTGREEN}${numAdded}${RESET}`);
	log(GENERAL, `Failed: ${BRIGHTRED}${numFailed}${RESET} / ${BRIGHTGREEN}${fileEntries.length}${RESET}`);
	for (let failedItem of failedList) {
		log(GENERAL, `${failedItem.name} ${failedItem.url}`);
		log(GENERAL, failedItem.reason);
		log(GENERAL, `----------------------------------------\n`);
	}

	if (logProcess) logOutput.end();
}

function processArguments(cmdline) {
	let inputPath = "";
	let outputPath = OUTPUT;
	let showErrors = false;
	let logProcess = false;
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
		else if (arg === "--log") {
			logProcess = true;
		}
	}

	if (!inputPath) {
		const help = [
			`usage:    ${GREEN}bin/app --input <list-path> [--output <output-path>] [--errors] [--log]${RESET}`,
			`          ${BRIGHTGREEN}$ bin/app --input ./lists/files-maps.txt --output fileinfo.txt --log${RESET}`,
			`          ${BRIGHTGREEN}$ node src/main.js --input ./lists/files-maps.txt --output fileinfo.txt --log${RESET}`,
			'options:',
			`  ${BRIGHTCYAN}--input${RESET}   input file path containing the list of download links`,
			`  ${BRIGHTCYAN}--ouput${RESET}   output file path, where the result is going to be stored, defaults to output.txt`,
			`  ${BRIGHTCYAN}--errors${RESET}  prints all errors, that are usually skipped`,
			`  ${BRIGHTCYAN}--log${RESET}     logs everything in the log file`
		];
		console.log(help.join('\n'));
		process.exit(0);
	}

	return [inputPath, outputPath, showErrors, logProcess];
}

main();
