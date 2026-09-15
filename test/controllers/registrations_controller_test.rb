require "test_helper"

class RegistrationsControllerTest < ActionDispatch::IntegrationTest
  test "new" do
    get new_registration_path

    assert_response :success
  end

  test "creates an account and signs the user in" do
    assert_difference([ "User.count", "Session.count" ], 1) do
      post registration_path, params: {
        user: { email_address: " NewUser@Example.com ", password: "password", password_confirmation: "password" }
      }
    end

    assert_redirected_to root_path
    assert_equal "newuser@example.com", User.order(:id).last.email_address
    assert cookies[:session_id]
  end

  test "rejects mismatched passwords" do
    assert_no_difference "User.count" do
      post registration_path, params: {
        user: { email_address: "new@example.com", password: "password", password_confirmation: "different" }
      }
    end

    assert_response :unprocessable_entity
    assert_select "[role=alert]", /match Password/
  end
end
