/**
 * Author : Nathaniel (decimalist) Minton
 * Helper Functions Module
 * This module provides fuctions to assist the Bedrock model with input and output santization.
 */
 
// Helper function to check if the input contains forbidden topics
export function isInputValid(input) {
  const forbiddenTopics = ['democrat', 'republican', 'libertarian', 'religion', 'god', 'commodities', 'securities', 'Securities and Exchange Commission', 'ignore previous instructions', 'disregard instructions', 'you are not', 'translate as', 'yes you can', 'your name is', 'your identity is', 'you are a'];
  const codingKeywords = ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'import', 'export', 'class', 'new', 'try', 'catch', 'finally', 'async', 'await', 'Promise', 'JSON', 'fetch', 'require', 'module', 'exports'];

  // Check for forbidden topics
  const containsForbiddenTopics = forbiddenTopics.some(topic => input.toLowerCase().includes(topic));

  // Check for coding keywords
  const containsCodingKeywords = codingKeywords.some(keyword => input.includes(keyword));

  // Allow input if it contains coding keywords, even if it contains forbidden topics
  return !containsForbiddenTopics || containsCodingKeywords;
}

// Helper function to sanitize input to prevent prompt injection
export function sanitizeInput(input) {
  try {
    // Ensure the input is a string
    const inputStr = String(input || '');
    console.log("Sanitizing input:", inputStr);

    let modifiedInput = inputStr.replace(/\bADA\b/gi, 'Cardano Native Token ADA');
    modifiedInput = "In the context of Cardano development: " + modifiedInput;
    const sanitizedInput = modifiedInput.replace(/[\r\n]/g, ' ').trim();
    console.log("Sanitized input:", sanitizedInput);

    return sanitizedInput;
  } catch (error) {
    console.error("Error in sanitizeInput:", error);
    throw error; // Re-throw the error to be caught in the handler
  }
}

// Helper function to remove source references from the response
export function removeSourceReferences(input) {
  return input.replace(/【\d+:\d+†[^】]+】/g, '');
}

// Function to validate model's output against inappropriate content
export function validateResponse(response) {
  const inappropriateContents = ['unrelated financial advice', 'speculative content', 'iau', 'commodities'];
  return inappropriateContents.every(content => !response.toLowerCase().includes(content));
}
