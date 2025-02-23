require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middlewares
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5000',
      'https://sky-view-5263b.web.app',
    ],
  })
);
app.use(express.json());

// custom middlewares

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.2fh4pkj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const apartmentCollection = client.db('skyViewDB').collection('apartments');
    const userCollection = client.db('skyViewDB').collection('users');
    const agreementCollection = client.db('skyViewDB').collection('agreements');
    const couponCollection = client.db('skyViewDB').collection('coupons');
    const paymentCollection = client.db('skyViewDB').collection('payments');
    const announcementCollection = client
      .db('skyViewDB')
      .collection('announcements');

    // jwt related api

    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.SECRET_ACCESS_TOKEN, {
        expiresIn: '24h',
      });
      res.send({ token });
    });

    const verifyToken = (req, res, next) => {
      const token = req.headers.authorization;
      if (!token) {
        console.log('token nai');
        return res.status(401).send({ message: 'Forbidden access' });
      }
      jwt.verify(token, process.env.SECRET_ACCESS_TOKEN, (err, decoded) => {
        if (err) {
          console.log('err token nai');
          return res.status(401).send({ message: 'Forbidden access' });
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next();
    };

    // users related api

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'User already exist', insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users', async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get('/members', verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find({ role: 'member' }).toArray();
      res.send(result);
    });

    app.patch('/users/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const filter = { email };
      const apartment = await agreementCollection.findOne(filter);
      if (apartment) {
        const apartmentId = apartment.apartmentId;
        const filterApartment = { _id: new ObjectId(apartmentId) };
        const apartmentUpdatedDoc = {
          $set: {
            status: 'available',
          },
        };
        const apartmentResult = await apartmentCollection.updateOne(
          filterApartment,
          apartmentUpdatedDoc
        );
      }
      const updatedDoc = {
        $set: {
          role: '',
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.get('/users/role/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'Unauthorized access' });
      }
      const user = await userCollection.findOne({ email });
      let userRole = '';
      if (user?.role === 'admin') {
        userRole = 'admin';
      }
      if (user?.role === 'member') {
        userRole = 'member';
      }
      res.send({ userRole });
    });

    // apartment related api

    app.get('/apartment', async (req, res) => {
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);
      const result = await apartmentCollection
        .find()
        .skip(size * (page - 1))
        .limit(size)
        .toArray();
      res.send(result);
    });

    app.get('/apartmentCount', async (req, res) => {
      const count = await apartmentCollection.estimatedDocumentCount();
      res.send({ count });
    });

    app.get('/unAvailableApartment', async (req, res) => {
      const unavailableRooms = await apartmentCollection.countDocuments({
        status: 'unavailable',
      });
      res.send({ unavailableRooms });
    });

    app.get('/agreement', verifyToken, verifyAdmin, async (req, res) => {
      const result = await agreementCollection.find().toArray();
      res.send(result);
    });

    app.get('/agreement/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await agreementCollection.findOne({ email });
      res.send(result);
    });

    app.post('/agreement', verifyToken, async (req, res) => {
      const data = req.body;
      const existingAgreement = await agreementCollection.findOne({
        email: data.email,
      });
      if (existingAgreement) {
        return res.send({
          message: 'Already applied an apartment',
          insertedId: null,
        });
      }
      const result = await agreementCollection.insertOne(data);
      res.send(result);
    });

    app.patch(
      '/agreement/checking/:id',
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const accept_date = req.body;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            accept_date: accept_date.currentDate,
            status: 'checked',
          },
        };
        const result = await agreementCollection.updateOne(filter, updatedDoc);
        if (req.query.check === 'approve') {
          const filterUser = { email: req.query.email };
          const filterApartment = { _id: new ObjectId(req.query.apartmentId) };
          const userUpdatedDoc = {
            $set: {
              role: 'member',
            },
          };
          const apartmentUpdatedDoc = {
            $set: {
              status: 'unavailable',
            },
          };
          const userResult = await userCollection.updateOne(
            filterUser,
            userUpdatedDoc
          );
          const apartmentResult = await apartmentCollection.updateOne(
            filterApartment,
            apartmentUpdatedDoc
          );
        }
        res.send(result);
      }
    );

    // announcement related api

    app.post('/announcement', verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      const result = await announcementCollection.insertOne(data);
      res.send(result);
    });

    app.get('/announcement', verifyToken, async (req, res) => {
      const result = await announcementCollection.find().toArray();
      res.send(result);
    });

    // coupon related api

    app.get('/coupons', async (req, res) => {
      const result = await couponCollection.find().toArray();
      res.send(result);
    });

    app.post('/coupons', verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      const result = await couponCollection.insertOne(data);
      res.send(result);
    });

    // payment intend & payment related api

    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const { price } = req.body;
      console.log('server', price);
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get('/payments/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const search = req.query.search;
      const query = { email };
      if (search) {
        query.month = { $regex: search, $options: 'i' };
        console.log(query);
      }
      console.log(search);
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post('/payments', async (req, res) => {
      const paymentData = req.body;
      const result = await paymentCollection.insertOne(paymentData);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('sky view server is running...');
});

app.listen(port, () => {
  console.log('sky view server is running on port', port);
});
