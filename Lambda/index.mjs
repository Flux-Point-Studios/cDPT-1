/**
 * Author : Nathaniel (decimalist) Minton
 * Main Module: Orchestrates the invocation of various submodules to construct a response for LEX. 
 * It includes prompt engineering and guidelines for Claude V3.
 */
 
 import { 
  invokeClaudeV3, 
  retrieveDocuments, 
  getSystemContext, 
  addUserInputToTranscript 
} from './bedrockUtils.mjs';

const formatErrorResponse = () => {
    return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Internal server error" })
    };
};

export async function handler(event) {
    console.log('Event received:', JSON.stringify(event));

    if (event.requestContext.http.method === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization"
            },
            body: JSON.stringify({ message: "CORS preflight request handled successfully" })
        };
    }

    const body = JSON.parse(event.body);
    const userInput = body.inputTranscript.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").replace(/•/g, '').replace(/^\d+\.\s*/gm, '');
    const initialContactId = body.initialContactId;
    const username = body.username || 'unknown';

    console.log(`User: ${username}, Input: ${userInput}`);

    try {
        const docsPromise = retrieveDocuments(userInput, "XOTTS4MUVI", "CETJLVLCJM");
        const { documents, retrievalQuery } = await docsPromise;

        let systemContext = getSystemContext(userInput, JSON.stringify(documents), retrievalQuery);

        console.log("systemContext : " + systemContext);

        const messages = addUserInputToTranscript(userInput, []);

        let completion = await invokeClaudeV3(systemContext, messages, userInput, retrievalQuery);

        console.log(`User: ${username}, Response: ${completion.response}`);

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization"
            },
            body: JSON.stringify(completion)
        };

    } catch (error) {
        console.error('Error:', error);
        return formatErrorResponse();
    }
};
