import axios from "axios";
import { AccessToken } from "livekit-server-sdk";
import dotenv from "dotenv";
import { mongooseConnection } from "../config/mongooseConfig.js";
import { CallReportModel } from "../models/callrReportModel.js";
import { AssistantOwnershipModel } from "../models/assistantOwnershipModel.js";

dotenv.config();

const FALLBACK_BACKEND_URL = "https://talkypie-backend-v3.onrender.com";
const defaultVapiApiKey =
  process.env.DEFAULT_VAPI_PRIVATE_KEY ||
  "a40bdb51-da75-4263-bd2f-28cc8f6593ed";

const assistantOwnerCache = new Map(); // key: assistantId => owner info

function buildProfileKey({ userId, childName, age, gender }) {
  return `${userId}:${childName}-${age || "na"}-${gender || "na"}`
    .trim()
    .toLowerCase();
}

async function upsertAssistantOwnership({
  assistantId,
  profileKey,
  childName,
  userId,
  userEmail,
  webhookUrl,
}) {
  await AssistantOwnershipModel.updateOne(
    { profileKey, userId },
    {
      $set: {
        assistantId,
        profileKey,
        childName,
        userId,
        userEmail,
        webhookUrl: webhookUrl || "",
      },
    },
    { upsert: true },
  );

  assistantOwnerCache.set(assistantId, { userId, userEmail });
}

function buildCustomPrompt({
  interests,
  currentLearning,
  customPrompt,
  prompt,
}) {
  let contextPrompt = "";
  if (interests) {
    contextPrompt += `Child's Interests & Preferences: ${interests}\n`;
  }
  if (currentLearning) {
    contextPrompt += `Current Learning in School: ${currentLearning}\n`;
  }
  if (customPrompt) {
    contextPrompt += `${customPrompt}\n`;
  }

  let finalPrompt = `You are a kid assistant, who helps engage kids in a fun playful manner.
Please be concise in your responses. Use very simple language that kids can understand and use short sentences.
${contextPrompt}Make sure to stay friendly and supportive.`;

  if (prompt) {
    finalPrompt = `${prompt}\n${contextPrompt}Make sure to stay friendly and supportive.`;
  }

  return finalPrompt;
}

function getAssistantIdFromReport(callReport) {
  return (
    callReport?.assistantId ||
    callReport?.call?.assistantId ||
    callReport?.assistant?.id ||
    null
  );
}

function normalizeBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function getRuntimeBackendUrl(req) {
  if (process.env.BACKEND_URL) {
    return normalizeBaseUrl(process.env.BACKEND_URL);
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req.protocol || "http";
  const host = req.get("host");

  if (!host) {
    return normalizeBaseUrl(FALLBACK_BACKEND_URL);
  }

  return normalizeBaseUrl(`${protocol}://${host}`);
}

function toWebsocketUrl(httpUrl) {
  if (httpUrl.startsWith("https://")) {
    return `wss://${httpUrl.slice("https://".length)}`;
  }
  if (httpUrl.startsWith("http://")) {
    return `ws://${httpUrl.slice("http://".length)}`;
  }
  return httpUrl;
}

export const createAssistant = async (req, res) => {
  let {
    childName,
    age,
    gender,
    customPrompt,
    vapiKey,
    prompt,
    toyName,
    customTranscript,
    interests,
    currentLearning,
  } = req.body;

  const profileKey = buildProfileKey({
    userId: req.user.id,
    childName,
    age,
    gender,
  });

  if (!childName) {
    return res.status(400).json({ error: "childName is required" });
  }

  if (!vapiKey || vapiKey === "null") {
    vapiKey = defaultVapiApiKey;
  }

  try {
    await mongooseConnection();
    const runtimeBackendUrl = getRuntimeBackendUrl(req);
    const webhookUrl = `${runtimeBackendUrl}/vapi/end-call-report`;

    const existingOwnership = await AssistantOwnershipModel.findOne({
      profileKey,
      userId: req.user.id,
    })
      .sort({ updatedAt: -1 })
      .lean();

    const canReuseOwnedAssistant =
      existingOwnership?.assistantId &&
      existingOwnership?.webhookUrl === webhookUrl;

    if (canReuseOwnedAssistant) {
      assistantOwnerCache.set(existingOwnership.assistantId, {
        userId: existingOwnership.userId,
        userEmail: existingOwnership.userEmail,
      });
      return res.status(200).json({
        assistantId: existingOwnership.assistantId,
        reused: true,
        message: "Existing assistant reused",
      });
    }

    const websocketUrl = `${toWebsocketUrl(runtimeBackendUrl)}/api/custom-transcriber`;
    const transcriptionSetup = customTranscript
      ? {
          provider: "custom-transcriber",
          server: { url: websocketUrl },
        }
      : {
          provider: "deepgram",
          model: "nova-2",
          language: "en-IN",
        };

    const finalPrompt = buildCustomPrompt({
      interests,
      currentLearning,
      customPrompt,
      prompt,
    });

    const response = await axios.post(
      "https://api.vapi.ai/assistant",
      {
        name: `Eva-${childName}`,
        model: {
          provider: "openai",
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: finalPrompt,
            },
          ],
          temperature: 0.3,
        },
        silenceTimeoutSeconds: 30,
        voice: {
          provider: "vapi",
          voiceId: "Emma",
          speed: 1,
        },
        transcriber: transcriptionSetup,
        stopSpeakingPlan: {
          backoffSeconds: 4,
        },
        firstMessage: `Hi ${childName || "there"}! I am ${
          toyName || "Eva"
        }! How can I assist you today?`,
        firstMessageMode: "assistant-speaks-first",
        serverMessages: ["end-of-call-report", "function-call"],
        server: {
          url: webhookUrl,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${vapiKey}`,
        },
      },
    );

    const assistantId = response.data.id;
    await upsertAssistantOwnership({
      assistantId,
      profileKey,
      childName,
      userId: req.user.id,
      userEmail: req.user.email,
      webhookUrl,
    });

    res.status(200).json({
      assistantId,
      reused: false,
      finalPrompt,
      message: "New assistant created",
    });
  } catch (error) {
    console.error(
      "Error creating assistant:",
      error.response?.data || error.message,
    );
    const upstreamStatus = error.response?.status;
    if (upstreamStatus === 401) {
      return res.status(401).json({ error: "Invalid VAPI private key" });
    }
    if (upstreamStatus === 402) {
      return res.status(402).json({ error: "VAPI credits exhausted" });
    }
    return res.status(500).json({ error: "Failed to create assistant" });
  }
};

export const storeCallReport = async (req, res) => {
  try {
    console.log("Hi I'm called from the /vapi/end-call-report");
    await mongooseConnection();

    if (req.body?.message?.type !== "end-of-call-report") {
      return res.status(400).json({ error: "Invalid message type" });
    }

    const callReport = req.body.message;
    const assistantId = getAssistantIdFromReport(callReport);
    console.log("assistat id", assistantId);
    if (!assistantId) {
      return res
        .status(400)
        .json({ error: "assistantId not found in call report" });
    }

    let owner = assistantOwnerCache.get(assistantId);
    console.log("owner is ", owner);
    if (!owner) {
      const ownershipRecord = await AssistantOwnershipModel.findOne({
        assistantId,
      }).lean();

      if (!ownershipRecord) {
        return res.status(404).json({
          error: "No ownership mapping found for this assistant",
        });
      }

      owner = {
        userId: ownershipRecord.userId,
        userEmail: ownershipRecord.userEmail,
      };
      assistantOwnerCache.set(assistantId, owner);
    }

    const val = await CallReportModel.create({
      ...callReport,
      assistantId,
      userId: owner.userId,
      userEmail: owner.userEmail,
    });
    console.log("stored value is ", val);
    return res.status(200).json({ message: "Call report stored successfully" });
  } catch (error) {
    console.error("Error storing call report:", error);
    return res.status(500).json({ error: "Failed to store call report" });
  }
};

export const getSessions = async (req, res) => {
  try {
    await mongooseConnection();

    const userId = req.user.id;
    const ownershipRecords = await AssistantOwnershipModel.find({
      userId,
    })
      .select("assistantId -_id")
      .lean();
    console.log(ownershipRecords);
    const ownedAssistantIds = ownershipRecords
      .map((record) => record.assistantId)
      .filter(Boolean);

    const orMatch = [{ userId }];
    if (ownedAssistantIds.length > 0) {
      orMatch.push({ assistantId: { $in: ownedAssistantIds } });
      orMatch.push({ "call.assistantId": { $in: ownedAssistantIds } });
      orMatch.push({ "assistant.id": { $in: ownedAssistantIds } });
    }

    const result = await CallReportModel.aggregate([
      { $match: { $or: orMatch } },
      {
        $project: {
          timestamp: { $ifNull: ["$timestamp", "$call.createdAt"] },
          cost: { $ifNull: ["$cost", "$costBreakdown.total"] },
          durationSeconds: {
            $ifNull: [
              "$durationSeconds",
              {
                $cond: [
                  { $ifNull: ["$durationMs", false] },
                  { $divide: ["$durationMs", 1000] },
                  0,
                ],
              },
            ],
          },
          summary: { $ifNull: ["$summary", "$analysis.summary"] },
          recordingUrl: {
            $ifNull: ["$recordingUrl", "$artifact.recordingUrl"],
          },
          durationMinutes: {
            $ifNull: [
              "$durationMinutes",
              {
                $cond: [
                  { $ifNull: ["$durationSeconds", false] },
                  { $divide: ["$durationSeconds", 60] },
                  0,
                ],
              },
            ],
          },
        },
      },
      {
        $facet: {
          data: [
            { $sort: { timestamp: -1 } },
            { $limit: 20 },
            {
              $project: {
                timestamp: 1,
                cost: 1,
                durationSeconds: 1,
                summary: 1,
                recordingUrl: 1,
              },
            },
          ],
          totals: [
            {
              $group: {
                _id: null,
                totalCost: { $sum: "$cost" },
                totalMinutes: { $sum: "$durationMinutes" },
                totalSessions: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    const callData = result[0]?.data || [];
    const totals = result[0]?.totals[0] || {
      totalCost: 0,
      totalMinutes: 0,
      totalSessions: 0,
    };

    return res.status(200).json({ callData, ...totals });
  } catch (error) {
    console.error("Error getting sessions:", error);
    return res.status(500).json({ error: "Failed to get sessions" });
  }
};

export const createLiveKitToken = async (req, res) => {
  try {
    const roomName = `talkypie-room-${req.user.id}`;
    const participantName = `talkypie-user-${req.user.id}`;

    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: participantName,
        ttl: "10m",
      },
    );
    at.addGrant({ roomJoin: true, room: roomName });

    const token = await at.toJwt();
    return res.status(200).json({ token, roomName, participantName });
  } catch (error) {
    console.error("Error creating LiveKit token:", error);
    return res.status(500).json({ error: "Failed to create LiveKit token" });
  }
};
