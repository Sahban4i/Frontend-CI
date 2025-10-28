import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectDB } from "../server.js";

let mongo;
let ready = false;

export async function setupTestDB() {
  if (!ready) {
    mongo = await MongoMemoryServer.create();
    await connectDB(mongo.getUri());
    ready = true;
  }
}

export async function teardownTestDB() {
  if (mongo) {
    await mongoose.disconnect();
    await mongo.stop();
    mongo = undefined;
    ready = false;
  }
}