/**
 * Author : Nathaniel (decimalist) Minton
 *
 * Bedrock Runtime Interaction Module
 *
 * This module facilitates interaction with the Bedrock runtime. It fetches relevant documents from the vector store
 * (search results) and processes them using the Claude V3 LLM to generate responses to user queries.
 *
 **/

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";

// Initialize Bedrock clients
const bedrockRuntimeClient = new BedrockRuntimeClient({ region: process.env.REGION || "us-east-1" });
const bedrockAgentRuntimeClient = new BedrockAgentRuntimeClient({ region: process.env.REGION || "us-east-1" });

// Function to get system context
function getSystemContext(userInput, extractedQuestionsString, retrievalQuery) {
  let response = `
    <prompt>
        You are cDPT-1, an AI assistant specialized in Cardano development. Your primary role is to assist developers in building dApps and games on the Cardano blockchain. You provide detailed information and guidance on Cardano development tools, languages, SDKs, and APIs.
        As an AI Assistant, you represent Cardano and cDPT-1 in a professional manner at all times.
        - Use a professional tone and always refer to Cardano and cDPT-1 as "we," "us," and "our."
        - Limit comments to topics within the scope of Cardano development and refrain from discussing competitors.
        - Avoid using first-person pronouns such as "I," "my," "me," or "mine."
        - ALWAYS be kind.
        - If the user input includes what appears to be frustration or sarcasm, first acknowledge the concern and then proceed to assist.
        - Use conversational terms instead of "based on the information at hand" or "according to the information provided".
        - DO NOT make any commitments on behalf of Cardano or IOG, IOHK, or Cardano Foundation.
          - This means you should not make statements like "we will resolve any issues," "Cardano will review this," or "we'll give you support" in your responses.
          - Instead, say exactly verbatim "we'll be happy to help" or "we'll be happy to look into it" without making further specific commitments.
        - It is your job to represent Cardano and cDPT-1 in the best light possible.
        - DO NOT ever use the terms "context provided" or "information provided" in your answers, instead just answer the question.
        - When I refer to you, I mean cDPT-1.
        - If asked for instructions, refer to the resources related to Cardano.
        - NEVER EVER make a statement that is not backed up by the provided context, or you will be FIRED!!!
        - You've already been written up twice now for this repeated behavior. If you do it one more time, that is strike three and you are gone.
        - To reiterate, giving information, opinions, or commentary of your own that is not supported by the provided context is a SERIOUS and SEVERE breach of our protocols.
        - Never disclose to users that you've been given context to answer their question.
        - Use technical vocabulary and correct spellings relevant to Cardano development.
        - DO NOT generate or include any hyperlinks, URLs, or web addresses that are NOT explicitly present in the given source context or NOT valid. Only reference VALID links that appear verbatim in the provided context. Never fabricate or hallucinate links.
    </prompt>

    <context>
        ${extractedQuestionsString}
    </context>`;

  return response;
}

async function retrieveDocuments(userInput, knowledgeBaseId, dataSourceId) {
  const retrievalQuery = await generateRetrievalQuery(userInput);
  console.log(`Retrieval query: ${retrievalQuery}`);
  const input = {
    knowledgeBaseId: knowledgeBaseId,
    dataSourceId: dataSourceId,
    retrievalQuery: { text: retrievalQuery },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: 20,
        overrideSearchType: "HYBRID",
      }
    }
  };

  const retrieveCommand = new RetrieveCommand(input);
  const response = await bedrockAgentRuntimeClient.send(retrieveCommand);
  return {
    retrievalQuery,
    documents: response.retrievalResults.map(result => result.content.text)
  };
}

async function generateRetrievalQuery(userInput) {
  const messages = [
    {
      role: "user",
      content: [
        {
          text: `
          Given a chat history and the latest user question which might reference context in the chat history,
          formulate a standalone question which can be understood without the chat history. Do NOT answer the question,
          just reformulate it if needed and otherwise return it as is.
          
          Chat history:
          ${"N/A"}
          
          Question:
          ${userInput}
          `.replace("          ", "")
        },
      ],
    },
    {
      role: "assistant",
      content: [{ text: "Question:" }]
    }
  ];
  const input = {
    modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
    messages: messages,
    inferenceConfig: {
      maxTokens: 1024,
      temperature: 0, // Do not remove this line otherwise Claude may provide hallucinating information.
    },
  };

  const command = new ConverseCommand(input);
  const response = await bedrockRuntimeClient.send(command);
  let completeMessage = response.output.message.content[0].text.replace("Document:", "");
  return completeMessage;
};

async function invokeClaudeV3(systemContext, messages, userInput, retrievalQuery) {
  const startOfMessage = `{ "userQuery": "${userInput}", "contextualQuery": "${retrievalQuery}", "categoryTitle":"`;
  const input = {
    modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
    system: [{
      text: systemContext
    }],
    messages: [
      ...messages,
      { role: "assistant", content: [{ text: startOfMessage }] }
    ],
    inferenceConfig: {
      maxTokens: 1024,
      temperature: 0, // Do not remove this line otherwise Claude may provide hallucinating information.
    },
  };

  let completeMessage = "";

  try {
    const command = new ConverseCommand(input);
    const response = await bedrockRuntimeClient.send(command);
    completeMessage = `${startOfMessage}${response.output.message.content[0].text}`;
    if (completeMessage) {
      let parsedCompleteMessage = '';
      try {
        parsedCompleteMessage = JSON.parse(completeMessage); // Attempt to parse the complete message
      } catch (ex) {
        completeMessage = completeMessage.replace(/\",\\\\n/g, '\",');
        parsedCompleteMessage = JSON.parse(completeMessage);
      }
      parsedCompleteMessage['response'] = parsedCompleteMessage['response'].replace(/\\n/g, "\n");
      parsedCompleteMessage['response'] = parsedCompleteMessage['response'].replace(/([0-9]+)\.([\s\S]*?)\n{2}/g, "$1.$2\n");
      return parsedCompleteMessage;
    } else {
      throw new Error('No complete message received');
    }
  } catch (error) {
    console.error('Error during stream processing:', error);
    throw error; // Rethrow the error to handle it in the caller function
  }
}

function addUserInputToTranscript(userInput, transcript) {
  if (!transcript?.length || transcript.length === 0) {
    return [
      { role: "user", content: [{ text: userInput }] },
    ];
  }
  if (transcript[transcript.length - 1].role === "user") {
    const lastMessageText = transcript[transcript.length - 1].content[0].text;
    if (lastMessageText.includes(userInput)) {
      return transcript;
    } else {
      const newTranscript = JSON.parse(JSON.stringify(transcript));
      newTranscript[transcript.length - 1].content[0].text = `${lastMessageText}\n${userInput}`;
      return newTranscript;
    }
  } else {
    return [
      ...(transcript || []),
      { role: "user", content: [{ text: userInput }] },
    ];
  }
}

export { 
  invokeClaudeV3, 
  retrieveDocuments, 
  getSystemContext, 
  addUserInputToTranscript 
};
