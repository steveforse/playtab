class User < ApplicationRecord
  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :songs, dependent: :destroy

  normalizes :email_address, with: ->(e) { e.strip.downcase }

  validates :email_address, presence: true, length: { maximum: 320 }, uniqueness: true
end
