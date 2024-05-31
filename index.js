const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const port = process.env.PORT || 5000;

// middlewares
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('sky view server is running...');
});

app.listen(port, () => {
  console.log('sky view server is running on port', port);
});
