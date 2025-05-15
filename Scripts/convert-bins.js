const csv = require('csvtojson');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// Promisify fs.existsSync for better async handling
const exists = promisify(fs.exists);

// Helper function to log errors and exit gracefully
const handleError = (message, error = null) => {
  console.error(message);
  if (error) {
    console.error(error);
  }
  process.exit(1);
};

async function main() {
  try {
    // Define CSV and output JSON paths
    const csvFile = path.join(__dirname, '../mock-data/bin-list.csv');
    const jsonFile = path.join(__dirname, '../mock-data/bins.json');

    // 1) Check if the CSV file exists
    const csvExists = await exists(csvFile);
    if (!csvExists) {
      handleError(`❌ CSV not found at ${csvFile}`);
    }

    // 2) Parse the CSV into a JSON array
    const rows = await csv().fromFile(csvFile);
    if (!rows || rows.length === 0) {
      handleError('❌ No data found in the CSV file.');
    }

    // 3) Build an object keyed by the BIN
    const out = Object.fromEntries(
      rows.map(r => [
        r.BIN,
        {
          bin: r.BIN,
          network: (r.Brand || '').toLowerCase(),
          issuer: r.Issuer || null,
          cardType: (r.Type || '').toLowerCase(),
          cardSubType: r.Category || null,
          country: r.isoCode2 || null
        }
      ])
    );

    // 4) Check if the output JSON file already exists and back it up
    if (fs.existsSync(jsonFile)) {
      const backupFile = jsonFile.replace('.json', `-${Date.now()}.json`);
      fs.renameSync(jsonFile, backupFile);
      console.log(`⚠️ Backing up the old bins.json to ${backupFile}`);
    }

    // 5) Write to bins.json
    fs.writeFileSync(jsonFile, JSON.stringify(out, null, 2));
    console.log(`✅ Written ${Object.keys(out).length} BIN entries to ${jsonFile}`);

  } catch (err) {
    handleError('Conversion failed:', err);
  }
}

main();