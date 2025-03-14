import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import { User } from "../models/user.model.js";
import {
  uploadOnCloudinary,
  destroyAssetFromCloudinary
} from "../utils/cloudinary.js";
import mongoose from "mongoose";

const getCurrentUser = async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "-password -refreshToken"
  );
  return res.status(200).json(
    new ApiResponse({
      status: 200,
      message: "User fetched successfully",
      data: user
    })
  );
};

const updateUserAccountDetails = async (req, res) => {
  const { fullName, username, email } = req.body;

  // If any field is empty
  if (!fullName || !username || !email) {
    throw new ApiError({
      status: 400,
      message: "All fields (i.e. fullName, username, email) are required "
    });
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: { fullName, username, email } },
    { new: true, runValidators: true }
  );
  if (!user) {
    throw new ApiError({
      status: 400,
      message: "Unable to retrive or update user account details"
    });
  }

  return res.status(200).json(
    new ApiResponse({
      status: 200,
      message: "User account details updated successfully"
    })
  );
};

const updateUserChannelDetails = async (req, res) => {
  // Middleware (verifyJWT) either sends a valid user in response or throws error and stop the process
  const user = await User.findById(req.user._id);

  // Accessing public_id of avatar or coverImage (if exists)
  const oldAvatarPublicId = user?.avatarPublicId;
  const oldCoverImagePublicId = user?.coverImagePublicId;

  // Local path of uploaded avatar and coverImage
  // These (.coverImage?. and .avatar?.) checks are useful when user wants to update only one field,
  // either avatar or either coverImage
  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

  // If user dont upload new images for avatar and coverImage
  if (!avatarLocalPath && !coverImageLocalPath) {
    throw new ApiError({
      status: 400,
      message: "no changes made by user for avatar and coverImage"
    });
  }

  // Uploads avatar and coverImage on cloudinary
  if (avatarLocalPath) {
    const newAvatar = await uploadOnCloudinary(
      avatarLocalPath,
      "image",
      "avatars"
    );
    if (!newAvatar) {
      throw new ApiError({
        status: 400,
        message: "Unable to upload avatar on cloudinary"
      });
    }
    user.avatar = newAvatar.url;
    user.avatarPublicId = newAvatar.public_id;
  }
  if (coverImageLocalPath) {
    const newCoverImage = await uploadOnCloudinary(
      coverImageLocalPath,
      "image",
      "coverImages"
    );
    if (!newCoverImage) {
      throw new ApiError({
        status: 400,
        message: "Unable to upload cover image on cloudinary"
      });
    }
    user.coverImage = newCoverImage.url;
    user.coverImagePublicId = newCoverImage.public_id;
  }

  await user.save({ validateBeforeSave: false });

  // Delete old avatar/coverImage from cloudinary
  if (oldAvatarPublicId) {
    const deleteOldAvatar = await destroyAssetFromCloudinary(oldAvatarPublicId);
    if (!deleteOldAvatar) {
      throw new ApiError({
        status: 500,
        message: "Unable to delete old avatar from cloudinary"
      });
    }
  }
  if (oldCoverImagePublicId) {
    const deleteOldCoverImage = await destroyAssetFromCloudinary(
      oldCoverImagePublicId
    );
    if (!deleteOldCoverImage) {
      throw new ApiError({
        status: 500,
        message: "Unable to delete old coverImage from cloudinary"
      });
    }
  }

  return res.status(200).json(
    new ApiResponse({
      status: 200,
      message:
        "New Avatar and CoverImage updated successfully and Removed old Avatar and CoverImage from cloudinary"
    })
  );
};

const changeUserPassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  // Throws an error if any of password field is empty
  if (!currentPassword || !newPassword || !confirmPassword) {
    throw new ApiError({
      status: 400,
      message: "All password fields are required"
    });
  }

  // Middleware (verifyJWT) either sends a valid user in response or throws error and stop the process
  const user = await User.findById(req.user._id);

  // Checks if currentPassword is correct
  const isPasswordCorrect = await user.isPasswordCorrect(currentPassword);
  if (!isPasswordCorrect) {
    throw new ApiError({
      status: 400,
      message: "Current Password is incorrect"
    });
  }

  // Checks if newPassword and confirmPassword both matches
  if (newPassword !== confirmPassword) {
    throw new ApiError({
      status: 400,
      message: "New passwords do not match"
    });
  }

  user.password = newPassword;
  await user.save({ validateBeforeSave: false });

  return res.status(200).json(
    new ApiResponse({
      status: 200,
      message: "Password changed successfully"
    })
  );
};

const getUserChannelProfile = async (req, res) => {
  const { username } = req.params;

  const channel = await User.aggregate([
    {
      $match: {
        username: username.toLowerCase()
      },
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers"
      },
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribed"
      },
      $addFields: {
        subscribersCount: {
          $size: "$subscribers"
        },
        subscribedCount: {
          $size: "$subscribed"
        },
        isSubscribed: {
          $cond: {
            if: { $in: [req.user?._id, "$subscribers"] },
            then: true,
            else: false
          }
        }
      },
      $project: {
        fullName: 1,
        username: 1,
        avatar: 1,
        coverImage: 1,
        subscribersCount: 1,
        subscribedCount: 1,
        isSubscribed: 1
      }
    }
  ]);

  if (!channel.length) {
    throw new ApiError({
      status: 400,
      message: "Channel does not exists"
    });
  }

  return res.status(200).json(
    new ApiResponse({
      status: 200,
      message: "Channel fetched successfully"
    })
  );
};

const getUserWatchHistory = async (req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.ObjectId(req.user._id)
      }
    },
    {
      $lookup: {
        from: "videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistoryVideos",
        pipeline: [
          {
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: "owner",
              pipeline: [
                {
                  $project: {
                    username: 1,
                    fullName: 1,
                    avatar: 1
                  }
                }
              ]
            }
          },
          {
            $addFields: {
              owner: {
                $first: "$owner"
              }
            }
          }
        ]
      }
    }
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse({
        status: 200,
        message: "Watch history fetched successfully",
        data: user[0].watchHistoryVideos
      })
    );
};

export {
  changeUserPassword,
  getCurrentUser,
  updateUserAccountDetails,
  updateUserChannelDetails,
  getUserChannelProfile,
  getUserWatchHistory
};
