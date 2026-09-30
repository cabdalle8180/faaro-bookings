import axios from "axios";

const BASE_URL = "https://sms.tabaarak.com";

export const loginSMS = async () => {
  const { data } = await axios.post(`${BASE_URL}/Auth/SMSLogin`, {
    Name: process.env.SMS_USER,
    Password: process.env.SMS_PASS,
  });

  return data.data.token;
};

export const sendSMS = async ({ phone, message }) => {
  const token = await loginSMS();

  const { data } = await axios.post(
    `${BASE_URL}/Sms/sendsms`,
    {
      smsMessage: message,
      mobile: [phone],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return data;
};