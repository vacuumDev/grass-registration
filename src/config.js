export const STICKY_PROXY = process.env.STICKY_PROXY;
export const ROTATING_PROXY = process.env.ROTATING_PROXY;
export const CAPMONSTER_KEY = process.env.CAPMONSTER_KEY;
export const MIN_DELAY = process.env.MIN_DELAY;
export const MAX_DELAY = process.env.MAX_DELAY;
export const IS_SEQUENTIAL = process.env.IS_SEQUENTIAL;
export const REDIS_URL = process.env.REDIS_URL;

function parseCountryCount(str = "") {
    return str
        .split(",")
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((pair) => {
            const [code, count] = pair.split("=");
            return [code.toLowerCase(), Number(count)];
        })
        .filter(([, n]) => Number.isFinite(n) && n > 0);
}

export const TARGET_COUNTS = parseCountryCount(process.env.COUNTRY_COUNT);
export const COUNTRIES = TARGET_COUNTS.map(([c]) => c).join(",");
