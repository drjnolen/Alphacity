const fs = require('fs');
const path = require('path');

async function uploadFile(filePath) {
    const fileName = path.basename(filePath);
    console.log(`Uploading ${fileName}...`);
    
    const fileBuffer = fs.readFileSync(filePath);
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    
    // Construct multipart form data body manually to avoid external deps
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    
    const body = Buffer.concat([
        Buffer.from(header, 'utf-8'),
        fileBuffer,
        Buffer.from(footer, 'utf-8')
    ]);

    const res = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: body
    });

    if (!res.ok) {
        throw new Error(`Upload failed with status ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    const viewerUrl = json.data.url;
    // tmpfiles.org direct link format: replace tmpfiles.org/ with tmpfiles.org/dl/
    const directUrl = viewerUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    console.log(`Successfully uploaded ${fileName}`);
    console.log(`Viewer: ${viewerUrl}`);
    console.log(`Direct URL: ${directUrl}\n`);
    return directUrl;
}

async function main() {
    try {
        const peerless = await uploadFile('C:\\Users\\Julia\\Downloads\\Peerless.png');
        const blackMarket = await uploadFile('C:\\Users\\Julia\\Downloads\\Black Market.png');
        const streetMod = await uploadFile('C:\\Users\\Julia\\Downloads\\Street Mod.png');
        
        console.log('Result URLs:');
        console.log(`PEERLESS_URL="${peerless}"`);
        console.log(`BLACK_MARKET_URL="${blackMarket}"`);
        console.log(`STREET_MOD_URL="${streetMod}"`);
    } catch (err) {
        console.error('Error during upload:', err);
    }
}

main();
