// little zip reader

const Transform = require('stream').Transform;
const zlib = require('zlib');
// zip entry signatures
const Signatures = {
    LocalFileHeader: 0x504b0304,
    CentralDirectory: 0x504b0102,
    EndCentralDirectory: 0x504b0506
};
// parses zip entry header
class LocalFileHeaderParser {

    constructor() {}

    newEntryObject() {
        return {
            signature: Signatures.LocalFileHeader,
            version: 0,
            flags: 0,
            compression: 0,
            modTime: 0,
            modDate: 0,
            crc32: null,
            compressedSize: 0,
            uncompressedSize: 0,
            fileNameLength: 0,
            extraFieldLength: 0,
            fileName: null,
            extraField: null,
            size: 0,
            data: null
        };
    }

    parse(buffer) {
        // not enough bytes to parse an entry chunk
        if (buffer.length < 30) {
            return false;
        }
        if (buffer.readUInt32BE() != Signatures.LocalFileHeader) {
            throw new Error('incorrect signature: ' + buffer.slice(0, 4).readUInt32LE().toString(16));
        }
        let entry = this.newEntryObject();
        entry.version = buffer.readUInt16LE(4);
        entry.flags = buffer.readUInt16LE(6);
        entry.compression = buffer.readUInt16LE(8);
        entry.modTime = buffer.readUInt16LE(10);
        entry.modDate = buffer.readUInt16LE(12);
        entry.crc32 = buffer.slice(14, 18);
        entry.compressedSize = buffer.readUInt32LE(18);
        entry.uncompressedSize = buffer.readUInt32LE(22);
        entry.fileNameLength = buffer.readUInt16LE(26);
        entry.extraFieldLength = buffer.readUInt16LE(28);
        let extraFieldOffset = 30 + entry.fileNameLength;
        let headerSize = extraFieldOffset + entry.extraFieldLength; 
        // not enough bytes to parse an entry chunk
        if (buffer.length < headerSize) {
            return false;
        }
        entry.fileName = buffer.slice(30, extraFieldOffset);
        entry.extraField = buffer.slice(extraFieldOffset, headerSize);
        entry.size = headerSize + entry.compressedSize; // total entry legth (header + data)
        if (buffer.length < entry.size) {
            return false; // we need more size
        }
        entry.data = buffer.slice(headerSize, headerSize + entry.compressedSize);
        return entry;
    }

}

class ZipEntryParser {

    constructor() {
        this.localFileHeaderParser = new LocalFileHeaderParser();
        this.centralDirectoryParser = null; // Not implemented
        this.endCentralDirectoryParser = null; // Not implemented
    }

    parse(buffer) {
        // not enough bytes to parse a chunk
        if (buffer.length < 4) {
            return false;
        }
        // read signature code
        switch(buffer.readUInt32BE()) {
        case Signatures.LocalFileHeader:
            return this.localFileHeaderParser.parse(buffer);
        case Signatures.CentralDirectory:
            return {signature: Signatures.CentralDirectory}; // Not implemented
        case Signatures.EndCentralDirectory:
            return {signature: Signatures.EndCentralDirectory}; // Not implemented
        default:
            throw new Error('unsupported entry signature: ' + buffer.slice(0, 4).readUInt32LE().toString(16));
        }
    }
}
// Reads entries from file stream
class ZipEntriesReader extends Transform {
    constructor(options) {
        super(options);
        this.parser = new ZipEntryParser();
        this.unprocessed = null;
        this.skip = 0; // compressed data length to skip
    }

    async _transform(chunk, encoding, next) {
        let entries = [];
        // main loop
        try {
            for (let entry of this.getNextEntry(chunk)) {
                /*  we only need local file headers, because they contain all data we need
                    hence we stop read once we hit central directory */
                if (entry.signature == Signatures.LocalFileHeader) {
                    entries.push(entry);
                }
                else {
                    this.end();
                    break;
                }
            }
            // we have data to process
            if (entries.length) {
                await this.process(entries);
            }
            next();
        }
        catch (err) {
            this.emit('error', err);
            this.end();
        }
    }

    * getNextEntry(chunk) {
        let buffer = this.getBuffer(chunk);
        if (!buffer) return;
        let entry;
        while (entry = this.parser.parse(buffer)) {
            yield entry;
            // buffer length is fully consist of compressed data
            if (entry.size > buffer.length) {
                this.skip = entry.size - buffer.length; // skip for next chunk
                return;
            }
            buffer = buffer.slice(entry.size);
        }
        this.unprocessed = buffer;
    }

    getBuffer(buffer) {
        if (this.skip) {
            // skip the whole chunk
            if (this.skip > buffer.length) {
                this.skip -= buffer.length;
                return;
            }
            buffer = buffer.slice(this.skip);
            this.skip = 0;
        }
        if (this.unprocessed) {
            buffer = Buffer.concat([this.unprocessed, buffer]);
            this.unprocessed = null;
        }
        return buffer;
    }
    // template method
    process(entries) {
        this.push(entries);
    }

}

module.exports = ZipEntriesReader;
