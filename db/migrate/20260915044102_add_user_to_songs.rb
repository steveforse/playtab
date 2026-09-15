class AddUserToSongs < ActiveRecord::Migration[8.1]
  def change
    # Keep existing local prototype rows readable while new writes become
    # owned by the authenticated account.
    add_reference :songs, :user, foreign_key: true
  end
end
