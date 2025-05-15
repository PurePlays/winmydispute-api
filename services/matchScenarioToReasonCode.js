import { lookupReasonCodeByScenario } from './reasonService.js';
import Fuse from 'fuse.js';  // Fuzzy matching library

// Supported networks in order of priority
const NETWORKS = ['visa', 'mastercard', 'amex', 'discover'];

// Set up fuzzy search options (for enhanced matching)
const fuseOptions = {
  threshold: 0.3,  // Lower threshold means higher sensitivity to minor misspellings
  keys: ['reasonCode', 'title', 'description'],  // Search within these fields
};

// Function to match user scenario to a reason code with fuzzy matching and detailed logging
export function matchScenarioToReasonCode(description, additionalData = {}) {
  const text = (description || '').toLowerCase();

  // Initialize logging data
  const logData = { scenario: text, additionalData };

  // Log the initial scenario for transparency
  console.log('Matching dispute scenario:', logData);

  // Array to hold possible matches from all networks
  const possibleMatches = [];

  for (const network of NETWORKS) {
    const result = lookupReasonCodeByScenario(network, text);
    
    if (result && result.reasonCode) {
      logData.matchFound = true;
      logData.network = network;

      // Log and return the best match found
      console.log('Match found for network', network, result);
      return { ...result, network, additionalData };
    } else {
      // If no exact match, try fuzzy matching with additional data
      try {
        const fuzzyResults = performFuzzySearch(network, text);
        if (fuzzyResults.length > 0) {
          possibleMatches.push({ network, results: fuzzyResults });
        }
      } catch (error) {
        console.error(`Error during fuzzy search for ${network}:`, error);
      }
    }
  }

  // If no exact match found, attempt fallback using fuzzy search results
  if (possibleMatches.length > 0) {
    console.log('No exact match found. Attempting fuzzy search results:', possibleMatches);
    return selectBestMatchFromFuzzyResults(possibleMatches);
  }

  // If no matches, return null and log the failure
  logData.matchFound = false;
  console.log('No suitable reason code found for scenario:', logData);
  return { reasonCode: null, title: null, description: null, network: null };
}

// Perform fuzzy search using a specified network
function performFuzzySearch(network, scenario) {
  const reasonCodes = getReasonCodesForNetwork(network);  // Get the full list of reason codes for the network
  const fuse = new Fuse(reasonCodes, fuseOptions);
  return fuse.search(scenario);
}

// Select the best match from fuzzy search results
function selectBestMatchFromFuzzyResults(matches) {
  const bestMatch = matches.reduce((best, current) => {
    const bestScore = best.results[0]?.score || 0;
    const currentScore = current.results[0]?.score || 0;

    return currentScore > bestScore ? current : best;
  });

  if (bestMatch) {
    console.log('Best fuzzy match found:', bestMatch);
    return bestMatch.results[0]?.item;
  }

  console.log('No fuzzy matches found.');
  return { reasonCode: null, title: null, description: null, network: null };
}

// Get the full list of reason codes for a given network
function getReasonCodesForNetwork(network) {
  // Ideally, this function would pull a comprehensive list of reason codes from a database or file
  // For the sake of this example, we're using a hardcoded list or an external service
  return [
    { reasonCode: '13.1', title: 'Item not received', description: 'The customer claims the item was not received' },
    { reasonCode: '12.1', title: 'Product damaged', description: 'The customer claims the product was damaged' },
    // More reason codes...
  ];
}