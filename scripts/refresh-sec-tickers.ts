#!/usr/bin/env tsx

// Script to refresh SEC company tickers from https://www.sec.gov/files/company_tickers.json
// Usage: npx tsx scripts/refresh-sec-tickers.ts [--from <local json>]

import fs from 'fs';
import path from 'path';

interface CompanyTicker {
  cik_str: string;
  ticker: string;
  title: string;
}

interface OutputCompany {
  cik: number;
  ticker: string;
  title: string;
}

interface OutputData {
  source: string;
  fetchedAt: string;
  count: number;
  companies: OutputCompany[];
}

async function fetchCompanyTickers(): Promise<CompanyTicker[]> {
  const secContactEmail = process.env.SEC_CONTACT_EMAIL;
  
  if (!secContactEmail || !secContactEmail.includes('@')) {
    console.error('Error: SEC_CONTACT_EMAIL environment variable is required and must contain "@"');
    process.exit(1);
  }

  const url = 'https://www.sec.gov/files/company_tickers.json';
  const response = await fetch(url, {
    headers: {
      'User-Agent': `catalyst-service company-universe refresh (${secContactEmail})`
    }
  });

  if (!response.ok) {
    console.error(`Failed to fetch from SEC: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const data = await response.json();
  return Object.values(data);
}

async function main() {
  let companyTickers: CompanyTicker[] = [];
  
  // Check if --from flag is provided
  const fromIndex = process.argv.indexOf('--from');
  if (fromIndex !== -1 && fromIndex + 1 < process.argv.length) {
    const filePath = process.argv[fromIndex + 1];
    try {
      const rawData = fs.readFileSync(filePath, 'utf-8');
      const parsedData = JSON.parse(rawData);
      companyTickers = Object.values(parsedData);
    } catch (error) {
      console.error(`Error reading from file ${filePath}:`, error);
      process.exit(1);
    }
  } else {
    // Fetch from SEC website
    companyTickers = await fetchCompanyTickers();
  }

  // Keep only the first occurrence of each CIK (primary listing)
  const seenCiks = new Set<string>();
  const uniqueCompanies: CompanyTicker[] = [];

  for (const company of companyTickers) {
    if (!seenCiks.has(company.cik_str)) {
      seenCiks.add(company.cik_str);
      uniqueCompanies.push(company);
    }
  }

  // Sort by ticker
  uniqueCompanies.sort((a, b) => a.ticker.localeCompare(b.ticker));

  // Transform to output format
  const outputCompanies: OutputCompany[] = uniqueCompanies.map(company => ({
    cik: parseInt(company.cik_str, 10),
    ticker: company.ticker,
    title: company.title
  }));

  const outputData: OutputData = {
    source: 'https://www.sec.gov/files/company_tickers.json',
    fetchedAt: new Date().toISOString(),
    count: outputCompanies.length,
    companies: outputCompanies
  };

  // Write to file as a single valid JSON document
  const outputPath = path.join('data', 'sec-company-tickers.json');
  const dirPath = path.dirname(outputPath);
  
  // Ensure directory exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));

  console.log(outputData.count);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});