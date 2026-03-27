import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const {
  getBinDataSummary,
  getBinMetadata,
  resetBinDataForTesting
} = await import('../services/binDataService.js');

const originalBinsFilePath = process.env.BINS_FILE_PATH;
const originalCsvFilePath = process.env.BIN_LIST_CSV_PATH;

afterEach(async () => {
  resetBinDataForTesting();

  if (originalBinsFilePath === undefined) {
    delete process.env.BINS_FILE_PATH;
  } else {
    process.env.BINS_FILE_PATH = originalBinsFilePath;
  }

  if (originalCsvFilePath === undefined) {
    delete process.env.BIN_LIST_CSV_PATH;
  } else {
    process.env.BIN_LIST_CSV_PATH = originalCsvFilePath;
  }
});

test('BIN data service falls back to the CSV source when the JSON store is empty', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'winmydispute-bin-tests-'));
  const binsFile = path.join(tempRoot, 'bins.json');
  const csvFile = path.join(tempRoot, 'bin-list.csv');

  await fs.writeFile(binsFile, '{}\n');
  await fs.writeFile(
    csvFile,
    [
      'BIN,Brand,Type,Category,Issuer,IssuerPhone,IssuerUrl,isoCode2,isoCode3,CountryName',
      '540805,MASTERCARD,CREDIT,TITANIUM,Capital One,800-227-4825,https://www.capitalone.com,US,USA,UNITED STATES'
    ].join('\n')
  );

  process.env.BINS_FILE_PATH = binsFile;
  process.env.BIN_LIST_CSV_PATH = csvFile;
  resetBinDataForTesting();

  const match = await getBinMetadata('540805');

  assert.equal(match?.bin, '540805');
  assert.equal(match?.network, 'mastercard');
  assert.equal(match?.issuer, 'Capital One');
  assert.equal(match?.country, 'US');

  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('BIN data summary counts JSON entries without loading the full lookup map', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'winmydispute-bin-tests-'));
  const binsFile = path.join(tempRoot, 'bins.json');
  const csvFile = path.join(tempRoot, 'bin-list.csv');

  await fs.writeFile(
    binsFile,
    `${JSON.stringify({
      '414720': { bin: '414720', network: 'visa' },
      '540805': { bin: '540805', network: 'mastercard' }
    }, null, 2)}\n`
  );
  await fs.writeFile(
    csvFile,
    [
      'BIN,Brand,Type,Category,Issuer,IssuerPhone,IssuerUrl,isoCode2,isoCode3,CountryName',
      '601100,DISCOVER,CREDIT,PLATINUM,Discover,800-347-2683,https://www.discover.com,US,USA,UNITED STATES'
    ].join('\n')
  );

  process.env.BINS_FILE_PATH = binsFile;
  process.env.BIN_LIST_CSV_PATH = csvFile;
  resetBinDataForTesting();

  const summary = getBinDataSummary();

  assert.equal(summary.count, 2);
  assert.equal(summary.source, 'bins.json');

  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('BIN data summary falls back to the CSV count when the JSON store is empty', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'winmydispute-bin-tests-'));
  const binsFile = path.join(tempRoot, 'bins.json');
  const csvFile = path.join(tempRoot, 'bin-list.csv');

  await fs.writeFile(binsFile, '{}\n');
  await fs.writeFile(
    csvFile,
    [
      'BIN,Brand,Type,Category,Issuer,IssuerPhone,IssuerUrl,isoCode2,isoCode3,CountryName',
      '540805,MASTERCARD,CREDIT,TITANIUM,Capital One,800-227-4825,https://www.capitalone.com,US,USA,UNITED STATES',
      '601100,DISCOVER,CREDIT,PLATINUM,Discover,800-347-2683,https://www.discover.com,US,USA,UNITED STATES'
    ].join('\n')
  );

  process.env.BINS_FILE_PATH = binsFile;
  process.env.BIN_LIST_CSV_PATH = csvFile;
  resetBinDataForTesting();

  const summary = getBinDataSummary();

  assert.equal(summary.count, 2);
  assert.equal(summary.source, 'bin-list.csv-fallback');

  await fs.rm(tempRoot, { recursive: true, force: true });
});
