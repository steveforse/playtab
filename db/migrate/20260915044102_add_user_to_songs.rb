class AddUserToSongs < ActiveRecord::Migration[8.1]
  def change
    # Existing local prototype rows are claimed by the first new account;
    # new writes are owned by the authenticated account.
    add_reference :songs, :user, foreign_key: true
  end
end
