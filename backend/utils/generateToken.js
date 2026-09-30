import jwt from 'jsonwebtoken';
import { refreshCookieOptions } from './refreshCookie.js';

const generateToken = (res, user) => {
    const payload = { id: user._id.toString(), version: user.tokenVersion ?? 0 };
    // Generate access token
    const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '15m',
    });

    // Generate refresh token
    const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: '7d',
    });

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
        ...refreshCookieOptions(),
        maxAge: 7 * 24 * 60 * 60 * 1000, 
    });

    return accessToken;
}

export default generateToken;
