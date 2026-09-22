import bcrypt from 'bcrypt';

export const hashPassword = password => bcrypt.hash(password, 12);
