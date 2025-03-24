import fs from 'fs/promises';
import { fork } from 'child_process';

async function main() {
    // Read and filter email accounts from file
    const emailsData = (await fs.readFile('data/emails.txt', 'utf-8'))
        .split('\n')
        .filter(line => line.trim() !== '');

    const batchSize = 3;
    const batches = [];

    // Split accounts into batches
    for (let i = 0; i < emailsData.length; i += batchSize) {
        batches.push(emailsData.slice(i, i + batchSize));
    }

    // Create an array of promises that resolve when each worker exits
    for (const [index, batch] of batches.entries()) {
        await new Promise((resolve, reject) => {
            const worker = fork('./src/worker.js');
            console.log(`Starting worker ${index} for ${batch.length} emails`);

            worker.send({ batch, index });

            worker.on('message', msg => {
                console.log(`Message from worker ${index}:`, msg);
            });

            worker.on('exit', code => {
                console.log(`Worker ${index} exited with code ${code}`);
                resolve();
            });

            worker.on('error', error => {
                console.error(`Worker ${index} encountered an error:`, error);
            });
        });
    }

    console.log("All workers have finished processing.");
    process.exit(0);
}

main();
