import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";
import { jwtVerify, createRemoteJWKSet } from "jose";
const app = express();
const port = 9000;

// Stripe secret key .env থেকে আসবে
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());
app.use(cors());

// ==========================================
// 1. DATABASE CONNECTION
// ==========================================

const client = new MongoClient(
  `mongodb://${process.env.MONGODB_USER}:${process.env.MONGODB_PASSWORD}@ac-myrwp58-shard-00-00.qzhspai.mongodb.net:27017,ac-myrwp58-shard-00-01.qzhspai.mongodb.net:27017,ac-myrwp58-shard-00-02.qzhspai.mongodb.net:27017/?ssl=true&replicaSet=atlas-xhguby-shard-0&authSource=admin`,
);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
    throw error;
  }
}

const dbClient = await connectToMongoDB();
const db = dbClient.db("assignment-9");

// Collections
const allItems = db.collection("allitem");
const users = db.collection("user");
const sessions = db.collection("session");
const favoriteItems = db.collection("favorite");
const cardAddItem = db.collection("cardadditem");
const reviewItem = db.collection("review");
const checkOutItem = db.collection("cehckOutData");
const paymentdata = db.collection("payment");

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

// MongoDB ObjectId valid কি না যাচাই
const isValidId = (id) => ObjectId.isValid(id);

// লগইন করা user-এর MongoDB ID string আকারে পাওয়া
const getUserId = (req) => req.user._id.toString();

// লগইন করা user-এর email পাওয়া
const getUserEmail = (req) => req.user.email;

// লগইন করা user-এর name পাওয়া
const getUserName = (req) => req.user.name || "User";

// ==========================================
// 3. AUTHENTICATION MIDDLEWARE
// ==========================================

// Middleware 1: User login আছে কি না যাচাই
const varifyUser = async (req, res, next) => {
  try {
    // Frontend থেকে Authorization header নেওয়া
    const authorization = req.headers.authorization;

    // Bearer token আছে কি না যাচাই
    if (!authorization?.startsWith("Bearer ")) {
      return res.status(401).send({
        success: false,
        message: "Authorization token is missing!",
      });
    }

    // Bearer বাদ দিয়ে শুধু token নেওয়া
    const token = authorization.split(" ")[1];

    if (!token) {
      return res.status(401).send({
        success: false,
        message: "Invalid authorization token!",
      });
    }

    // Better Auth session collection থেকে valid session খোঁজা
    const session = await sessions.findOne({
      token,
      expiresAt: { $gt: new Date() },
    });

    // Session না থাকলে অথবা expire হলে
    if (!session) {
      return res.status(401).send({
        success: false,
        message: "Invalid or expired session!",
      });
    }

    // Session-এর userId দিয়ে user খোঁজা
    const user = await users.findOne({
      _id: session.userId,
    });

    if (!user) {
      return res.status(401).send({
        success: false,
        message: "User not found!",
      });
    }

    // Suspended বা banned user-কে access দেওয়া হবে না
    if (user.banned === true) {
      return res.status(403).send({
        success: false,
        message: "Your account has been suspended!",
      });
    }

    // পরবর্তী route-এ user information পাওয়া যাবে
    req.user = user;

    next();
  } catch (error) {
    console.error("Authentication Error:", error);

    return res.status(401).send({
      success: false,
      message: "Authentication failed!",
    });
  }
};

// ==========================================
// 4. ADMIN AUTHORIZATION MIDDLEWARE
// ==========================================
// Middleware 2: শুধু Admin access করতে পারবে
const verifyAdmin = (req, res, next) => {
  // এই middleware-এর আগে অবশ্যই varifyUser ব্যবহার করতে হবে
  if (req.user?.role !== "admin") {
    return res.status(403).send({
      success: false,
      message: "Forbidden! Admin access required.",
    });
  }

  next();
};

// ==========================================
// 5. PUBLIC PRODUCT ROUTES
// ==========================================

// Get all approved products
app.get("/all-data-show", async (req, res) => {
  try {
    const query = {
      approvalStatus: "approved",
    };

    // Category filter
    if (req.query.category) {
      query.category = req.query.category;
    }

    // Availability filter
    if (req.query.isAvailable !== undefined) {
      query.isAvailable = req.query.isAvailable === "true";
    }

    // Product name search
    if (req.query.name) {
      query.name = {
        $regex: req.query.name,
        $options: "i",
      };
    }

    // Description search
    if (req.query.description) {
      query.description = {
        $regex: req.query.description,
        $options: "i",
      };
    }

    // Price range filter
    if (req.query.minPrice || req.query.maxPrice) {
      query.price = {};

      if (req.query.minPrice) {
        query.price.$gte = Number(req.query.minPrice);
      }

      if (req.query.maxPrice) {
        query.price.$lte = Number(req.query.maxPrice);
      }
    }

    // Preparation time filter
    if (req.query.prepTime) {
      query.prepTime = {
        $lte: Number(req.query.prepTime),
      };
    }

    // Vendor name filter
    if (req.query.userName) {
      query.userName = req.query.userName;
    }

    const result = await allItems.find(query).toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Get Products Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to get data",
    });
  }
});

// Get 6 approved products for homepage
app.get("/home-page-6-data", async (req, res) => {
  try {
    const products = await allItems
      .find({
        approvalStatus: "approved",
      })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    res.status(200).send(products);
  } catch (error) {
    console.error("Home Page Products Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch menu items",
    });
  }
});

// ==========================================
// 6. CUSTOMER / VENDOR PRODUCT ROUTES
// ==========================================

// Get approved product details
app.get("/details-page/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid product ID",
      });
    }

    const result = await allItems.findOne({
      _id: new ObjectId(id),
      approvalStatus: "approved",
    });

    if (!result) {
      return res.status(404).send({
        success: false,
        message: "Product not found or not approved",
      });
    }

    res.status(200).send(result);
  } catch (error) {
    console.error("Product Details Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch product details",
    });
  }
});

// Get vendor product count
// URL-এর email ব্যবহার না করে login করা user-এর email নেওয়া হচ্ছে
app.get("/vendor-apply-count/:userEmail", varifyUser, async (req, res) => {
  try {
    const count = await allItems.countDocuments({
      userEmail: getUserEmail(req),
    });

    res.status(200).send({
      count,
      freeLimit: 3,
      remainingFreePosts: Math.max(0, 3 - count),
      isLimitReached: count >= 3,
    });
  } catch (error) {
    console.error("Vendor Post Count Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to count vendor posts",
    });
  }
});

// Get logged-in vendor's products
app.get("/vendor-create-item/:gmail", varifyUser, async (req, res) => {
  try {
    const result = await allItems
      .find({
        userEmail: getUserEmail(req),
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Vendor Products Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch vendor products",
    });
  }
});

// Add new product
app.post("/vendor-add-item", varifyUser, async (req, res) => {
  try {
    const item = req.body;

    // Required fields validation
    if (!item.name || !item.category || item.price === undefined) {
      return res.status(400).send({
        success: false,
        message: "Required product information missing",
      });
    }

    const price = Number(item.price);

    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).send({
        success: false,
        message: "Invalid product price",
      });
    }

    // User information server-side থেকে নেওয়া হচ্ছে
    const newItem = {
      userId: getUserId(req),
      userName: getUserName(req),
      userEmail: getUserEmail(req),

      image: item.image || "",
      name: item.name,
      category: item.category,
      price,
      description: item.description || "",
      imageUrl: item.imageUrl || "",
      location: item.location || "",
      prepTime: Number(item.prepTime) || 0,
      isAvailable: item.isAvailable ?? true,

      // নতুন product admin approval-এর জন্য pending থাকবে
      approvalStatus: "pending",

      createdAt: new Date(),
    };

    const result = await allItems.insertOne(newItem);

    res.status(201).send({
      success: true,
      message: "Product submitted for admin approval",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Vendor Add Item Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to add item",
    });
  }
});

// ==========================================
// 7. CART ROUTES
// ==========================================

// Add product to cart
app.post("/add-card-item", varifyUser, async (req, res) => {
  try {
    const { itemId } = req.body;

    if (!itemId || !isValidId(itemId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid product ID",
      });
    }

    // Database থেকে original product নেওয়া
    const product = await allItems.findOne({
      _id: new ObjectId(itemId),
      approvalStatus: "approved",
    });

    if (!product) {
      return res.status(404).send({
        success: false,
        message: "Product not found or not approved",
      });
    }

    // নিজের cart-এ একই product আগে আছে কি না
    const existingCartItem = await cardAddItem.findOne({
      itemId: product._id.toString(),
      userEmail: getUserEmail(req),
    });

    if (existingCartItem) {
      return res.status(409).send({
        success: false,
        message: "Already added to cart",
      });
    }

    // Product information database থেকে নেওয়া হচ্ছে
    const cartData = {
      itemId: product._id.toString(),
      userEmail: getUserEmail(req),
      userName: getUserName(req),

      name: product.name,
      price: Number(product.price),
      imageUrl: product.imageUrl,
      category: product.category,
      description: product.description,

      quantity: 1,
      createdAt: new Date(),
    };

    const result = await cardAddItem.insertOne(cartData);

    res.status(201).send({
      success: true,
      message: "Added to cart successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Add Cart Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to add cart item",
    });
  }
});

// Get logged-in user's cart
app.get("/get-card-item/:email", varifyUser, async (req, res) => {
  try {
    const result = await cardAddItem
      .find({
        userEmail: getUserEmail(req),
      })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Get Cart Items Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch cart items",
    });
  }
});

// Update cart quantity
app.patch("/update-card-quantity/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid cart item ID",
      });
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).send({
        success: false,
        message: "Invalid quantity",
      });
    }

    // শুধু নিজের cart item update করতে পারবে
    const result = await cardAddItem.updateOne(
      {
        _id: new ObjectId(id),
        userEmail: getUserEmail(req),
      },
      {
        $set: {
          quantity,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Cart item not found",
      });
    }

    res.status(200).send({
      success: true,
      message: "Cart quantity updated successfully",
    });
  } catch (error) {
    console.error("Update Cart Quantity Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to update cart quantity",
    });
  }
});

// Delete cart item
app.delete("/card-delete-item/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid cart item ID",
      });
    }

    // শুধু নিজের cart item delete করতে পারবে
    const result = await cardAddItem.deleteOne({
      _id: new ObjectId(id),
      userEmail: getUserEmail(req),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Cart item not found",
      });
    }

    res.status(200).send({
      success: true,
      message: "Cart item removed successfully",
    });
  } catch (error) {
    console.error("Delete Cart Item Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to remove cart item",
    });
  }
});

// ==========================================
// 8. FAVORITE ROUTES
// ==========================================

// Add favorite item
app.post("/favorite-items", varifyUser, async (req, res) => {
  try {
    const { itemId } = req.body;

    if (!itemId || !isValidId(itemId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid product ID",
      });
    }

    // Original product database থেকে নেওয়া
    const product = await allItems.findOne({
      _id: new ObjectId(itemId),
      approvalStatus: "approved",
    });

    if (!product) {
      return res.status(404).send({
        success: false,
        message: "Product not found",
      });
    }

    const existingFavorite = await favoriteItems.findOne({
      itemId: product._id.toString(),
      userEmail: getUserEmail(req),
    });

    if (existingFavorite) {
      return res.status(409).send({
        success: false,
        message: "Already added to favorites",
      });
    }

    const favoriteData = {
      itemId: product._id.toString(),
      userEmail: getUserEmail(req),
      userName: getUserName(req),

      name: product.name,
      price: Number(product.price),
      imageUrl: product.imageUrl,
      category: product.category,
      description: product.description,

      createdAt: new Date(),
    };

    const result = await favoriteItems.insertOne(favoriteData);

    res.status(201).send({
      success: true,
      message: "Added to favorites successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Add Favorite Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to add favorite item",
    });
  }
});

// Get logged-in user's favorite items
app.get("/favorite-item-get-dashboard/:gmail", varifyUser, async (req, res) => {
  try {
    const result = await favoriteItems
      .find({
        userEmail: getUserEmail(req),
      })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Get Favorite Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch favorite items",
    });
  }
});

// Delete favorite item
app.delete("/favorite-delete-item/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid favorite ID",
      });
    }

    const result = await favoriteItems.deleteOne({
      _id: new ObjectId(id),
      userEmail: getUserEmail(req),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Favorite item not found",
      });
    }

    res.status(200).send({
      success: true,
      message: "Favorite item removed successfully",
    });
  } catch (error) {
    console.error("Delete Favorite Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to remove favorite item",
    });
  }
});

// ==========================================
// 9. REVIEW ROUTES
// ==========================================

// Add review
app.post("/add-review-item", varifyUser, async (req, res) => {
  try {
    const { itemId, review, rating } = req.body;

    if (!itemId || !isValidId(itemId) || !review) {
      return res.status(400).send({
        success: false,
        message: "Required review information is missing",
      });
    }

    const product = await allItems.findOne({
      _id: new ObjectId(itemId),
      approvalStatus: "approved",
    });

    if (!product) {
      return res.status(404).send({
        success: false,
        message: "Product not found",
      });
    }

    // User information session থেকে নেওয়া হচ্ছে
    const reviewData = {
      itemId: product._id.toString(),
      userEmail: getUserEmail(req),
      userName: getUserName(req),
      review,
      rating,
      createdAt: new Date(),
    };

    const result = await reviewItem.insertOne(reviewData);

    res.status(201).send({
      success: true,
      message: "Review submitted successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Add Review Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to submit review",
    });
  }
});

// Get logged-in user's reviews
app.get("/get-review-item/:gmail", varifyUser, async (req, res) => {
  try {
    const result = await reviewItem
      .find({
        userEmail: getUserEmail(req),
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Get Review Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch review items",
    });
  }
});

// Delete own review
app.delete("/review-delete-item/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid review ID",
      });
    }

    const result = await reviewItem.deleteOne({
      _id: new ObjectId(id),
      userEmail: getUserEmail(req),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Review not found",
      });
    }

    res.status(200).send({
      success: true,
      message: "Review removed successfully",
    });
  } catch (error) {
    console.error("Delete Review Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to remove review",
    });
  }
});

// ==========================================
// 10. VENDOR ORDER ROUTES
// ==========================================

// Get logged-in vendor's orders
// Duplicate route সরিয়ে একটি route রাখা হয়েছে
app.get("/vendor-orders/:vendorId", varifyUser, async (req, res) => {
  try {
    // URL-এর vendorId বিশ্বাস করা হচ্ছে না
    const vendorId = getUserId(req);

    const orders = await checkOutItem
      .find({ vendorId })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send({
      success: true,
      totalOrders: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Vendor Orders Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch vendor orders",
    });
  }
});

// Update vendor order status
app.patch("/vendor-order-status/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid order ID",
      });
    }

    const allowedStatuses = ["Processing", "Ready", "Delivered", "Rejected"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).send({
        success: false,
        message: "Invalid order status",
      });
    }

    // নিজের vendor ID দিয়েই order খোঁজা হবে
    const vendorId = getUserId(req);

    const order = await checkOutItem.findOne({
      _id: new ObjectId(id),
      vendorId,
    });

    if (!order) {
      return res.status(404).send({
        success: false,
        message: "Order not found or unauthorized vendor",
      });
    }

    const currentStatus = order.status;

    // কোন status থেকে কোন status-এ যাওয়া যাবে
    const statusFlow = {
      Pending: ["Processing", "Rejected"],
      Processing: ["Ready"],
      Ready: ["Delivered"],
      Delivered: [],
      Rejected: [],
    };

    if (!statusFlow[currentStatus]?.includes(status)) {
      return res.status(400).send({
        success: false,
        message: `Cannot change status from ${currentStatus} to ${status}`,
      });
    }

    const result = await checkOutItem.updateOne(
      {
        _id: new ObjectId(id),
        vendorId,
        status: currentStatus,
      },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount === 0) {
      return res.status(409).send({
        success: false,
        message: "Order status was already changed. Please refresh.",
      });
    }

    res.status(200).send({
      success: true,
      message: "Order status updated successfully",
      orderId: id,
      previousStatus: currentStatus,
      newStatus: status,
    });
  } catch (error) {
    console.error("Order Status Update Error:", error);

    res.status(500).send({
      success: false,
      message: "Internal server error",
    });
  }
});

// Update vendor product availability
app.patch("/vendor-update-availability/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid menu item ID",
      });
    }

    if (typeof isAvailable !== "boolean") {
      return res.status(400).send({
        success: false,
        message: "isAvailable must be a boolean",
      });
    }

    // শুধু নিজের product update করতে পারবে
    const result = await allItems.updateOne(
      {
        _id: new ObjectId(id),
        userId: getUserId(req),
      },
      {
        $set: {
          isAvailable,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Menu item not found or unauthorized",
      });
    }

    res.status(200).send({
      success: true,
      message: "Availability updated successfully",
    });
  } catch (error) {
    console.error("Update Availability Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to update availability",
    });
  }
});

// ==========================================
// 11. CUSTOMER CHECKOUT / ORDER ROUTES
// ==========================================

// Checkout and create vendor-wise orders
app.post("/checkout-data-item", varifyUser, async (req, res) => {
  try {
    const { phone, address, items } = req.body;

    if (!phone || !address || !Array.isArray(items) || items.length === 0) {
      return res.status(400).send({
        success: false,
        message: "Required order information is missing",
      });
    }

    // সব product ID ও quantity validate করা
    const validatedItems = [];

    for (const item of items) {
      if (
        !item.itemId ||
        !isValidId(item.itemId) ||
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) < 1
      ) {
        return res.status(400).send({
          success: false,
          message: "Invalid order item",
        });
      }

      // Frontend-এর price/name বিশ্বাস না করে database থেকে নেওয়া
      const menuItem = await allItems.findOne({
        _id: new ObjectId(item.itemId),
        approvalStatus: "approved",
        isAvailable: true,
      });

      if (!menuItem || !menuItem.userId) {
        return res.status(400).send({
          success: false,
          message: "Product unavailable or vendor information missing",
        });
      }

      validatedItems.push({
        itemId: menuItem._id.toString(),
        vendorId: String(menuItem.userId),
        name: menuItem.name,
        price: Number(menuItem.price),
        imageUrl: menuItem.imageUrl,
        category: menuItem.category,
        quantity: Number(item.quantity),
      });
    }

    // Vendor অনুযায়ী products ভাগ করা
    const vendorGroups = {};

    validatedItems.forEach((item) => {
      const vendorId = item.vendorId;

      if (!vendorGroups[vendorId]) {
        vendorGroups[vendorId] = [];
      }

      vendorGroups[vendorId].push(item);
    });

    // মোট subtotal
    const subtotal = validatedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const deliveryFee = 50;
    const orders = [];

    // প্রতিটি vendor-এর জন্য আলাদা order
    for (const [vendorId, vendorItems] of Object.entries(vendorGroups)) {
      const vendorSubtotal = vendorItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );

      const orderData = {
        vendorId,

        // Customer information session থেকে নেওয়া
        userName: getUserName(req),
        userEmail: getUserEmail(req),

        phone,
        address,
        items: vendorItems,

        subtotal: vendorSubtotal,
        deliveryFee: 0,
        total: vendorSubtotal,

        status: "Pending",
        paymentStatus: "Unpaid",

        createdAt: new Date(),
      };

      orders.push(orderData);
    }

    // একবারই delivery fee যোগ হবে
    if (orders.length > 0) {
      orders[0].deliveryFee = deliveryFee;
      orders[0].total += deliveryFee;
    }

    const result = await checkOutItem.insertMany(orders);

    res.status(201).send({
      success: true,
      message: "Orders placed successfully",
      orderIds: Object.values(result.insertedIds),
      vendorCount: orders.length,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
    });
  } catch (error) {
    console.error("Checkout Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to place order",
    });
  }
});

// Get logged-in customer's orders
app.get("/customer-order-view/:email", varifyUser, async (req, res) => {
  try {
    const result = await checkOutItem
      .find({
        userEmail: getUserEmail(req),
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Customer Order Fetch Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch customer orders",
    });
  }
});

// ==========================================
// 12. STRIPE PAYMENT ROUTES
// ==========================================

// Verify Stripe checkout payment
app.post("/payment/checkout-verify", varifyUser, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).send({
        success: false,
        message: "Session ID is required",
      });
    }

    // Stripe থেকে checkout session retrieve
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent.payment_method"],
    });

    const {
      id,
      status,
      customer_email,
      customer_details,
      metadata,
      payment_intent,
      payment_status,
      amount_total,
    } = stripeSession;

    // Payment complete এবং paid কি না যাচাই
    if (status !== "complete" || payment_status !== "paid") {
      return res.status(400).send({
        success: false,
        message: "Payment is not completed",
      });
    }

    const userId = metadata?.userId;

    if (!userId || !isValidId(userId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid or missing User ID",
      });
    }

    // সবচেয়ে গুরুত্বপূর্ণ যাচাই:
    // Stripe session যে user-এর, সেই user-ই request করছে কি না
    if (String(userId) !== getUserId(req)) {
      return res.status(403).send({
        success: false,
        message: "You are not allowed to verify this payment",
      });
    }

    // একই Stripe session আগে save হয়েছে কি না
    const existingPayment = await paymentdata.findOne({
      sessionId: id,
      userId: getUserId(req),
    });

    if (existingPayment) {
      return res.status(200).send({
        success: true,
        message: "Payment already verified",
        payment: existingPayment,
      });
    }

    // Payment intent information
    const paymentIntent =
      payment_intent && typeof payment_intent !== "string"
        ? payment_intent
        : null;

    // Card information
    const paymentMethod =
      paymentIntent?.payment_method &&
      typeof paymentIntent.payment_method !== "string"
        ? paymentIntent.payment_method
        : null;

    const card = paymentMethod?.card;

    // Payment document
    const payment = {
      sessionId: id,

      userId: getUserId(req),
      userName: getUserName(req),
      customer_email:
        customer_details?.email || customer_email || getUserEmail(req),

      plan: metadata?.plan || "",
      billingCycle: metadata?.billingCycle || "",

      amount_total: (amount_total || 0) / 100,

      status,
      payment_status,

      payment_date: new Date(),

      payment_intent:
        typeof payment_intent === "string"
          ? payment_intent
          : payment_intent?.id || "",

      card_brand: card?.brand || "unknown",
      card_last4: card?.last4 || "",
    };

    // Payment save
    const result = await paymentdata.insertOne(payment);

    // নিজের account-এর premium information update
    const updateResult = await users.updateOne(
      {
        _id: req.user._id,
      },
      {
        $set: {
          premium: true,
          currentPlan: payment.plan,
          billingCycle: payment.billingCycle,
        },
      },
    );

    res.status(200).send({
      success: true,
      message: "Payment verified successfully",
      paymentId: result.insertedId,
      payment,
      updateResult,
    });
  } catch (error) {
    console.error("Payment Verify Error:", error);

    res.status(500).send({
      success: false,
      message: "Payment verification failed",
    });
  }
});

// Get logged-in user's premium information
app.get("/user-payment/:id/premium", varifyUser, async (req, res) => {
  try {
    // URL-এর ID নয়, session-এর user ID ব্যবহার
    const userId = getUserId(req);

    const result = await paymentdata.findOne(
      {
        userId,
        payment_status: "paid",
      },
      {
        sort: {
          payment_date: -1,
        },
      },
    );

    if (!result) {
      return res.status(200).send({
        success: true,
        premium: null,
      });
    }

    const nextBillingDate = new Date(result.payment_date);

    if (result.billingCycle === "monthly") {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else if (result.billingCycle === "yearly") {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }

    res.status(200).send({
      success: true,
      premium: {
        plan: result.plan,
        billingCycle: result.billingCycle,
        amount: result.amount_total,
        paymentDate: result.payment_date,
        nextBillingDate,
        status: result.payment_status,
      },
    });
  } catch (error) {
    console.error("Premium Fetch Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch premium details",
    });
  }
});

// Get logged-in user's payment history
app.get("/payment-history/:userId", varifyUser, async (req, res) => {
  try {
    const history = await paymentdata
      .find({
        userId: getUserId(req),
      })
      .sort({
        payment_date: -1,
      })
      .toArray();

    res.status(200).send({
      success: true,
      history,
    });
  } catch (error) {
    console.error("Payment History Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch payment history",
    });
  }
});

// ==========================================
// 13. ADMIN PAYMENT ROUTES
// ==========================================

// Admin: Get all payment history
app.get("/admin-payment-history", varifyUser, verifyAdmin, async (req, res) => {
  try {
    const payments = await paymentdata
      .find({})
      .sort({ payment_date: -1 })
      .toArray();

    res.status(200).send({
      success: true,
      payments,
    });
  } catch (error) {
    console.error("Admin Payment History Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to get payment history",
    });
  }
});

// ==========================================
// 14. ADMIN PRODUCT MANAGEMENT
// ==========================================

// Admin: Get pending products
app.get(
  "/admin/pending-products",
  varifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const products = await allItems
        .find({ approvalStatus: "pending" })
        .sort({ createdAt: -1 })
        .toArray();

      res.status(200).send({
        success: true,
        products,
      });
    } catch (error) {
      console.error("Pending Products Error:", error);

      res.status(500).send({
        success: false,
        message: "Failed to fetch pending products",
      });
    }
  },
);

// Admin: Approve or reject product
app.patch(
  "/admin/product-status/:id",
  varifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { approvalStatus } = req.body;

      if (!isValidId(id)) {
        return res.status(400).send({
          success: false,
          message: "Invalid product ID",
        });
      }

      if (!["approved", "rejected"].includes(approvalStatus)) {
        return res.status(400).send({
          success: false,
          message: "Invalid approval status",
        });
      }

      const result = await allItems.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            approvalStatus,
            reviewedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          success: false,
          message: "Product not found",
        });
      }

      res.status(200).send({
        success: true,
        message: `Product ${approvalStatus} successfully`,
      });
    } catch (error) {
      console.error("Product Status Update Error:", error);

      res.status(500).send({
        success: false,
        message: "Failed to update product status",
      });
    }
  },
);

// ==========================================
// 15. ADMIN VENDOR MANAGEMENT
// ==========================================

// Admin: Get all vendors
app.get("/admin/vendors", varifyUser, verifyAdmin, async (req, res) => {
  try {
    const vendors = await users
      .find({
        accountType: "vendor",
      })
      .sort({
        createdAt: -1,
      })
      .toArray();

    const vendorsWithItems = await Promise.all(
      vendors.map(async (vendor) => {
        const itemCount = await allItems.countDocuments({
          userId: vendor._id.toString(),
        });

        return {
          ...vendor,
          itemCount,
        };
      }),
    );

    res.status(200).send({
      success: true,
      vendors: vendorsWithItems,
    });
  } catch (error) {
    console.error("Get Vendors Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch vendors",
    });
  }
});

// Admin: Update vendor status
app.patch(
  "/admin/vendor-status/:id",
  varifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { vendorStatus } = req.body;

      if (!isValidId(id)) {
        return res.status(400).send({
          success: false,
          message: "Invalid vendor ID",
        });
      }

      const allowedStatus = ["approved", "rejected", "suspended"];

      if (!allowedStatus.includes(vendorStatus)) {
        return res.status(400).send({
          success: false,
          message: "Invalid vendor status",
        });
      }

      const result = await users.updateOne(
        {
          _id: new ObjectId(id),
          accountType: "vendor",
        },
        {
          $set: {
            vendorStatus,
            vendorStatusUpdatedAt: new Date(),

            // Suspended হলে user banned হবে
            banned: vendorStatus === "suspended",
            banReason:
              vendorStatus === "suspended"
                ? "Suspended by administrator"
                : null,
            banExpires: null,
          },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          success: false,
          message: "Vendor not found",
        });
      }

      res.status(200).send({
        success: true,
        message: `Vendor ${vendorStatus} successfully`,
      });
    } catch (error) {
      console.error("Vendor Status Update Error:", error);

      res.status(500).send({
        success: false,
        message: "Failed to update vendor status",
      });
    }
  },
);

// ==========================================
// 16. ADMIN DASHBOARD STATISTICS
// ==========================================

app.get("/admin/dashboard-stats", varifyUser, verifyAdmin, async (req, res) => {
  try {
    const [
      totalCustomers,
      totalVendors,
      totalRestaurants,
      totalPizzaItems,
      totalOrders,
      pendingVendorApplications,
      revenueResult,
    ] = await Promise.all([
      // Total customers
      users.countDocuments({
        accountType: { $ne: "vendor" },
        role: { $ne: "admin" },
      }),

      // Total vendors
      users.countDocuments({
        accountType: "vendor",
      }),

      // Total restaurants
      users.countDocuments({
        accountType: "vendor",
        businessName: { $exists: true, $ne: "" },
      }),

      // Total products
      allItems.countDocuments({}),

      // Total orders
      checkOutItem.countDocuments({}),

      // Pending vendor applications
      users.countDocuments({
        accountType: "vendor",
        vendorStatus: "pending",
      }),

      // Successful payment revenue
      paymentdata
        .aggregate([
          {
            $match: {
              status: "complete",
              payment_status: "paid",
            },
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$amount_total" },
            },
          },
        ])
        .toArray(),
    ]);

    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    res.status(200).send({
      success: true,
      stats: {
        totalCustomers,
        totalVendors,
        totalRestaurants,
        totalPizzaItems,
        totalOrders,
        totalRevenue,
        pendingVendorApplications,
      },
    });
  } catch (error) {
    console.error("Admin Dashboard Stats Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch dashboard statistics",
    });
  }
});

// ==========================================
// 17. VENDOR PRODUCT EDIT / DELETE
// ==========================================

// Get single product for edit
app.get("/vendor/product/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid product ID",
      });
    }

    // শুধু নিজের product দেখতে পারবে
    const product = await allItems.findOne({
      _id: new ObjectId(id),
      userId: getUserId(req),
    });

    if (!product) {
      return res.status(404).send({
        success: false,
        message: "Product not found or unauthorized",
      });
    }

    res.status(200).send({
      success: true,
      product,
    });
  } catch (error) {
    console.error("Get Product Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch product",
    });
  }
});

// Update own product
app.patch("/vendor/product/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      category,
      price,
      description,
      imageUrl,
      location,
      prepTime,
      isAvailable,
    } = req.body;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid product ID",
      });
    }

    if (!name || !category || price === undefined || !description) {
      return res.status(400).send({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).send({
        success: false,
        message: "Invalid product price",
      });
    }

    // Ownership check: নিজের product ছাড়া update করা যাবে না
    const result = await allItems.updateOne(
      {
        _id: new ObjectId(id),
        userId: getUserId(req),
      },
      {
        $set: {
          name,
          category,
          price: numericPrice,
          description,
          imageUrl,
          location,
          prepTime,
          isAvailable,
          updatedAt: new Date(),

          // Edit করার পর আবার admin approval প্রয়োজন
          approvalStatus: "pending",
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Product not found or unauthorized",
      });
    }

    res.status(200).send({
      success: true,
      message: "Product updated and submitted for approval",
    });
  } catch (error) {
    console.error("Update Product Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to update product",
    });
  }
});

// Delete own product
app.delete("/vendor-delete-item/:id", varifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid product ID",
      });
    }

    // শুধু নিজের product delete করতে পারবে
    const result = await allItems.deleteOne({
      _id: new ObjectId(id),
      userId: getUserId(req),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Menu item not found or unauthorized",
      });
    }

    res.status(200).send({
      success: true,
      message: "Menu item deleted successfully",
    });
  } catch (error) {
    console.error("Delete Menu Item Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to delete menu item",
    });
  }
});

// ==========================================
// 18. SERVER
// ==========================================

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
