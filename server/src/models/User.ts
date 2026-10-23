import { model, Schema } from "mongoose";

export type UserRole = "owner" | "staff";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  email: {
    type: String, required: true, trim: true, lowercase: true, maxlength: 254,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  passwordHash: { type: String, required: true, select: false },
  cafeId: { type: Schema.Types.ObjectId, ref: "Cafe", required: true, index: true },
  role: { type: String, required: true, enum: ["owner", "staff"] },
  isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true, toJSON: { transform: (_document, value) => {
  const safe = value as Record<string, unknown>;
  delete safe.passwordHash;
  delete safe.__v;
  return value;
} } });

userSchema.index({ email: 1 }, { unique: true });

export const User = model("User", userSchema);
