import fs from 'fs/promises';
import { fork } from 'child_process';

async function main() {
    // Read and filter email accounts from file
    const emailsData = (await fs.readFile('data/emails.txt', 'utf-8'))
        .split('\n')
        .filter(line => line.trim() !== '');

    const batchSize = 5;
    const batches = [];

    // Split accounts into batches
    for (let i = 0; i < emailsData.length; i += batchSize) {
        batches.push(emailsData.slice(i, i + batchSize));
    }

    // Create an array of promises that resolve when each worker exits
    const workerPromises = batches.map((batch, index) => {
        return new Promise((resolve, reject) => {
            const worker = fork('./src/worker.js'); // adjust the path if needed

            // Send the batch along with an index for logging purposes
            worker.send({ batch, index });

            worker.on('message', (msg) => {
                console.log(`Message from worker ${index}:`, msg);
            });

            worker.on('exit', (code) => {
                console.log(`Worker ${index} exited with code ${code}`);
                resolve();
            });

            worker.on('error', (error) => {
                console.error(`Worker ${index} encountered an error:`, error);
                reject(error);
            });
        });
    });

    // Wait for all workers to finish processing
    await Promise.all(workerPromises);
    console.log("All workers have finished processing.");

    process.exit(0);
}

main();
