import express from "express";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import User from "../models/User.js";

const router = express.Router();

const sign = (u) => jwt.sign({ id: u._id, email: u.email }, process.env.JWT_SECRET, { expiresIn: "15m" });

router.post(
  "/register",
  [body("email").isEmail(), body("password").isLength({ min: 6 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password } = req.body;
    try {
      const exists = await User.findOne({ email });
      if (exists) return res.status(409).json({ message: "Email already registered" });
      const user = await User.create({ email, password });
      res.status(201).json({ token: sign(user), user: { id: user._id, email: user.email } });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  }
);

router.post(
  "/login",
  [body("email").isEmail(), body("password").isString()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user || !(await user.comparePassword(password)))
        return res.status(401).json({ message: "Invalid credentials" });
      res.json({ token: sign(user), user: { id: user._id, email: user.email } });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  }
);

export default router;