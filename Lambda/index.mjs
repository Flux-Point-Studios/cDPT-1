/**
 * Author : Nathaniel (decimalist) Minton
 * Main Module: Orchestrates the invocation of various submodules to construct a response for LEX. 
 * It includes prompt engineering and guidelines for Claude V3.
 */
 
import { 
  isInputValid, 
  sanitizeInput, 
  removeSourceReferences, 
  validateResponse 
} from './helperFunctions.mjs'; 

import { 
  invokeClaudeV3, 
  retrieveDocuments, 
  getSystemContext, 
  addUserInputToTranscript, 
  getChatTranscript,
  saveChatTranscript,
  invokeWithRetry
} from './bedrockUtils.mjs';

const getCommonHeaders = () => ({
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
});

const formatErrorResponse = (error = "Internal server error") => {
  return {
    statusCode: 500,
    headers: getCommonHeaders(),
    body: JSON.stringify({ message: error })
  };
};

export async function handler(event, context) {
  console.log(`Lambda invoked: ${new Date().toISOString()} with event:`, JSON.stringify(event));

  context.callbackWaitsForEmptyEventLoop = false;

  if (event.requestContext?.http?.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCommonHeaders(),
      body: JSON.stringify({ message: "CORS preflight request handled successfully" })
    };
  }

  try {
    const body = JSON.parse(event.body);
    let userInput = body.inputTranscript || '';
    const initialContactId = body.initialContactId;
    const username = body.username || 'unknown';

    console.log(`User: ${username}, Input: ${userInput}`);

    // ** Step 1: Sanitize and validate the input **
    userInput = sanitizeInput(userInput);  // Sanitize input to prevent prompt injection
    console.log(`Sanitized Input: ${userInput}`);

    // ** Step 2: Check if input is valid **
    if (!isInputValid(userInput)) {
      console.warn(`Invalid input detected: ${userInput}`);
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Invalid input detected. Please provide a valid query." })
      };
    }

    // ** Step 3: Fetch conversation history and add user input to it **
    let conversationHistory = await getChatTranscript(initialContactId);
    conversationHistory = addUserInputToTranscript(userInput, conversationHistory);

    // ** Step 4: Retrieve documents and build the system context for the model **
    const docsPromise = retrieveDocuments(userInput, "XOTTS4MUVI", "CETJLVLCJM");
    const { documents } = await docsPromise;
    let systemContext = getSystemContext(userInput, JSON.stringify(documents));

    // Log the shortened context (first 100 characters)
    console.log("systemContext : " + systemContext.substring(0, 100) + "...");

    const maxRetries = 1;
    const delay = 500;

    let completion;
    try {
      // ** Step 5: Invoke the model (remove documents from this call) **
      completion = await invokeWithRetry(systemContext, conversationHistory, userInput, maxRetries, delay); // Remove `documents`
    } catch (error) {
      console.error('All retries failed:', error);
      completion = {
        response: "I'm sorry, but I couldn't generate a response at this time. Please try again later."
      };
    }

    // ** Step 6: Validate the model's response **
    if (!validateResponse(completion.response)) {
      console.warn(`Inappropriate content detected in the model's response: ${completion.response}`);
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "The model's response contains inappropriate content." })
      };
    }

    // ** Step 7: Optionally remove any source references from the model's response **
    completion.response = removeSourceReferences(completion.response);

    // ** Step 8: Store the final response if it's new and not a repeat of earlier outputs **
    if (!conversationHistory.some(item => item?.content?.[0]?.text === completion.response)) {
      conversationHistory.push({ role: "assistant", content: [{ text: completion.response }] });
    
      try {
        // Save the chat transcript for both the user and the assistant
        await saveChatTranscript(initialContactId, "USER", userInput);
        await saveChatTranscript(initialContactId, "ASSISTANT", completion.response);
        console.log("Chat transcript saved successfully.");
      } catch (error) {
        console.error("Error saving chat transcript:", error);
      }
    }


    console.log(`Final Response to User: ${completion.response}`);

    // ** Step 9: Return only the final validated message **
    return {
      statusCode: 200,
      headers: getCommonHeaders(),
      body: JSON.stringify({ message: completion.response })
    };

  } catch (error) {
    console.error('Error:', error);
    return formatErrorResponse("Failed to process user input");
  }
}
