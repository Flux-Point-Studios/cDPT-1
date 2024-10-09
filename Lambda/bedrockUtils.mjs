/**
 * Author : Nathaniel (decimalist) Minton
 * Bedrock Runtime Interaction Module
 * This module facilitates interaction with the Bedrock runtime.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand, QueryCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const bedrockRuntimeClient = new BedrockRuntimeClient({ region: process.env.REGION || "us-east-1" });
const bedrockAgentRuntimeClient = new BedrockAgentRuntimeClient({ region: process.env.REGION || "us-east-1" });
const dynamoClient = new DynamoDBClient({ region: process.env.REGION || "us-east-1" });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Create the system context for the Bedrock invocation
function getSystemContext(userInput, extractedQuestionsString) {
  return `
    <prompt>
        You are cDPT-1, an AI assistant specialized in Cardano development. Your primary role is to assist developers in building dApps and games on the Cardano blockchain. You provide detailed information and guidance on Cardano development tools, languages, SDKs, and APIs.
        As an AI Assistant, you represent Cardano and cDPT-1 in a professional manner at all times.
        - Use a professional tone.
        - Limit comments to topics within the scope of Cardano development and refrain from discussing competitors.
        - Avoid using first-person pronouns such as "I," "my," "me," or "mine."
        - ALWAYS be kind.
        - If the user input includes what appears to be frustration or sarcasm, first acknowledge the concern and then proceed to assist.
        - Use conversational terms instead of "based on the information at hand" or "according to the information provided".
        - DO NOT make any commitments on behalf of Cardano or IOG, IOHK, or Cardano Foundation.
        - You are expected to represent Cardano and cDPT-1 in the best possible light.
    </prompt>
    <context>
        ${extractedQuestionsString}
    </context>`;
}

// Retrieve documents from Bedrock Agent
async function retrieveDocuments(userInput, knowledgeBaseId, dataSourceId) {
  const input = {
    knowledgeBaseId: knowledgeBaseId,
    dataSourceId: dataSourceId,
    retrievalQuery: {
      text: userInput // Query with the user's input
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: 20,
        overrideSearchType: "HYBRID",
      }
    }
  };

  const retrieveCommand = new RetrieveCommand(input);
  try {
    const response = await bedrockAgentRuntimeClient.send(retrieveCommand);
    return {
      documents: response.retrievalResults.map(result => result.content.text)
    };
  } catch (error) {
    console.error('Error retrieving documents:', error);
    throw error;
  }
}

// Direct invocation of Claude model without chunking
async function invokeClaudeV3(systemContext, messages, userInput) {
  const input = {
    modelId: "anthropic.claude-3-haiku-20240307-v1:0",
    system: [{
      text: systemContext
    }],
    messages: [
      {
        role: "user",  // Human message
        content: [
          {
            text: `Human: ${userInput}`
          }
        ]
      },
      {
        role: "assistant",  // Assistant expected response
        content: [
          {
            text: `Assistant:`
          }
        ]
      }
    ],
    inferenceConfig: {
      maxTokens: 4096,
      temperature: 0,
    },
  };

  console.log("Final input to Bedrock:", JSON.stringify(input, null, 2));

  try {
    const command = new ConverseCommand(input);
    const response = await bedrockRuntimeClient.send(command);

    // Add detailed logging here
    console.log("Raw Bedrock Response:", JSON.stringify(response, null, 2));

    // Check if message content is empty or malformed
    if (!response?.output?.message?.content?.length || !response.output.message.content[0]?.text) {
      console.error('Invalid response from Bedrock runtime, content missing:', JSON.stringify(response, null, 2));
      throw new Error('Unexpected response structure or empty content from Bedrock runtime');
    }

    const completeMessage = response.output.message.content[0].text;

    console.log("Complete Message:", completeMessage);

    return {
      response: completeMessage
    };
  } catch (error) {
    console.error('Error during stream processing:', error);
    throw error;
  }
}


// Retry mechanism without chunking
async function invokeWithRetry(systemContext, messages, userInput, maxRetries, delay) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const completion = await invokeClaudeV3(systemContext, messages, userInput);
      return completion;
    } catch (error) {
      console.error(`Retry ${i + 1}/${maxRetries} failed:`, error);
      if (i < maxRetries - 1) await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
    }
  }
  
  // Fallback in case all retries fail
  return {
    response: "Sorry, I couldn't process your request. Please try again later."
  };
}


// Save chat transcript to DynamoDB
async function saveChatTranscript(initialContactId, role, content) {
  const timestamp = new Date().toISOString();
  const item = {
    InitialContactId: initialContactId,
    Timestamp: timestamp,
    ParticipantRole: role,
    Content: content,
    Type: "MESSAGE"
  };

  const command = new PutCommand({
    TableName: process.env.TRANSCRIPT_TABLE,
    Item: item
  });

  try {
    await docClient.send(command);
    console.log("Chat transcript saved successfully.");
  } catch (error) {
    console.error("Error saving chat transcript:", error);
    throw error;
  }
}

// Fetch chat transcript from DynamoDB
async function getChatTranscript(initialContactId) {
  const command = {
    TableName: process.env.TRANSCRIPT_TABLE,
    KeyConditionExpression: "InitialContactId = :icid",
    ExpressionAttributeValues: { ":icid": initialContactId },
    Limit: 25,
  };

  try {
    const response = await docClient.send(new QueryCommand(command));
    return response.Items || [];
  } catch (error) {
    console.error("Error fetching chat transcript:", error);
    return [];
  }
}

// Add user input to transcript
function addUserInputToTranscript(userInput, transcript = []) {
  const lastMessage = transcript[transcript.length - 1];

  if (lastMessage?.role === "user" && !lastMessage.content[0].text.includes(userInput)) {
    lastMessage.content.push({ text: userInput });
  } else {
    transcript.push({ role: "user", content: [{ text: userInput }] });
  }

  return transcript;
}

export {
  retrieveDocuments,
  invokeClaudeV3,
  getSystemContext,
  getChatTranscript,
  saveChatTranscript,
  addUserInputToTranscript,
  invokeWithRetry
};
