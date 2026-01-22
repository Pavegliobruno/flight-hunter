const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
	{
		chatId: {
			type: String,
			required: true,
			unique: true,
		},
		username: {
			type: String,
			default: null,
		},
		firstName: {
			type: String,
			default: null,
		},
		lastName: {
			type: String,
			default: null,
		},
		status: {
			type: String,
			enum: ['pending', 'active', 'blocked'],
			default: 'pending',
		},
		isAdmin: {
			type: Boolean,
			default: false,
		},
		lastActivity: {
			type: Date,
			default: Date.now,
		},
	},
	{
		timestamps: true,
	}
);

module.exports = mongoose.model('User', userSchema);
