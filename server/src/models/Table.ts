import { model, Schema } from "mongoose";

const tableSchema = new Schema({
  cafeId: { type: Schema.Types.ObjectId, ref: "Cafe", required: true },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
  qrCode: {
    type: String,
    required: true,
    trim: true,
    match: /^[A-Za-z0-9_-]{8,128}$/,
  },
  isActive: { type: Boolean, required: true, default: true },
});

tableSchema.index({ qrCode: 1 }, { unique: true });
tableSchema.index({ cafeId: 1, name: 1 }, { unique: true });

export const CafeTable = model("Table", tableSchema);
