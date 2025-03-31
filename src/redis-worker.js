import redis from "redis";
import {REDIS_URL} from "./config.js";

class RedisWorker {
  static client;

  static async init() {
    const client = redis.createClient({
      url: REDIS_URL
    });

    client.on("error", (err) => console.error("Redis error:", err));
    await client.connect();

    this.client = client;
  }

  static async setSession(key, value) {
    return await this.client.set(key, value);
  }

  static async getSession(key) {
    return await this.client.get(key);
  }
}

export default RedisWorker;
