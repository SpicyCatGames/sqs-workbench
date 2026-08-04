a .net webapi with a react TS frontend with vite

The frontend will have a settings icon which will show options to change - aws endpoint url, region, access key, secret access key

The homepage will show all the sqs queues available, with buttons create queue, delete queue, send message, purge queue

Create queue dialog - option "FIFO Queue"
Once you click a queue, the UI will be just the same as AWS and there will be all the options, including setting up a queue as dead letter queue, redrive policy, visibility timeout etc.

set up the react frontend so that the spa built files are static files that the .net api can show. In the wwwroot folder. I don't want a node server.

set it up to be published to docker hub

credentials for testing
AWS_ENDPOINT_URL=http://localhost:4566
AWS_DEFAULT_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test