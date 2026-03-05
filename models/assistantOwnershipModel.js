import mongoose from "mongoose";

const assistantOwnershipSchema = new mongoose.Schema(
  {
    assistantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    profileKey: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    userEmail: {
      type: String,
      required: true,
    },
    webhookUrl: {
      type: String,
      required: false,
      default: "",
    },
    childName: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

assistantOwnershipSchema.index({ profileKey: 1, userId: 1 });

export const AssistantOwnershipModel =
  mongoose.models.AssistantOwnership ||
  mongoose.model("AssistantOwnership", assistantOwnershipSchema);
