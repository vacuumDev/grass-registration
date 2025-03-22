import redis from 'redis';

class RedisWorker {
    static client;
    static async init() {
        const client = redis.createClient({
            socket: {
                host: 'localhost',
                port: 6379
            },
            password: 'fhg384f3h387f383f30h43h84'
        });

        client.on("error", (err) => console.error("Redis error:", err));
        await client.connect();
        const exists = await client.exists("currentIndex");
        if (!exists) {
            await client.set("currentIndex", 0);
        }
        this.client = client;
    }

    static async resetIndex() {
        return this.client.set("currentIndex", 0);
    }

    // Retrieves the current value of 'currentIndex'
    static async getIndex() {
        const value = await this.client.get("currentIndex");
        return Number(value);
    }

    // Increments the 'currentIndex' and returns the new value
    static async increment() {
        return await this.client.incr("currentIndex");
    }

    // A convenience method that gets and increments the index
    static async getNext() {
        const index = await RedisWorker.getIndex();
        await RedisWorker.increment();
        return index;
    }

    static async setSession(key, value) {
        return await this.client.set(key, value);
    }

    static async getSession(key) {
        return await this.client.get(key);
    }
}

export default RedisWorker;